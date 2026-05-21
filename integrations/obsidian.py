"""
Obsidian vault integration.

Reads and writes Markdown files to a local Obsidian vault following the
PARA structure (Projects / Areas / Resources / Archive).

Vault layout expected:
    0-Inbox/
    1-Projects/
    2-Areas/
        Clients/
        SEO-Research/
    3-Resources/
        Research/
        Tool-Docs/
    4-Archive/
    Maps/
    _Templates/
"""
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

import frontmatter
from jinja2 import Environment, FileSystemLoader, select_autoescape

from core.config import settings
from core.logger import logger


class ObsidianNote:
    def __init__(self, path: Path, metadata: dict, body: str):
        self.path = path
        self.metadata = metadata
        self.body = body
        self.title = metadata.get("title", path.stem)

    @property
    def content(self) -> str:
        return self.body

    def __repr__(self) -> str:
        return f"<ObsidianNote {self.path.name}>"


class ObsidianVault:
    """Read/write interface for an Obsidian vault."""

    STRUCTURE = {
        "inbox": "0-Inbox",
        "projects": "1-Projects",
        "clients": "2-Areas/Clients",
        "seo_research": "2-Areas/SEO-Research",
        "research": "3-Resources/Research",
        "tool_docs": "3-Resources/Tool-Docs",
        "archive": "4-Archive",
        "maps": "Maps",
        "templates": "_Templates",
    }

    def __init__(self, vault_path: Optional[Path] = None):
        path = vault_path or settings.vault_path
        if not path:
            raise RuntimeError(
                "OBSIDIAN_VAULT_PATH is not set. Add it to .env or pass vault_path."
            )
        self.root = Path(path)
        if not self.root.exists():
            raise RuntimeError(f"Vault path does not exist: {self.root}")
        self._ensure_structure()
        self._jinja = Environment(
            loader=FileSystemLoader(str(Path(__file__).parent.parent / "obsidian" / "templates")),
            autoescape=select_autoescape([]),
        )

    # ── Init ────────────────────────────────────────────────────────────────

    def _ensure_structure(self):
        for rel in self.STRUCTURE.values():
            (self.root / rel).mkdir(parents=True, exist_ok=True)

    def _resolve(self, rel_path: str) -> Path:
        return self.root / rel_path

    # ── Write ────────────────────────────────────────────────────────────────

    def write_note(
        self,
        rel_path: str,
        body: str,
        metadata: Optional[dict] = None,
        overwrite: bool = True,
    ) -> Path:
        """Write (or create) a note. Returns absolute path."""
        full = self._resolve(rel_path)
        full.parent.mkdir(parents=True, exist_ok=True)
        if full.exists() and not overwrite:
            logger.info("obsidian_note_skip_exists", path=rel_path)
            return full

        post = frontmatter.Post(body, **(metadata or {}))
        full.write_text(frontmatter.dumps(post), encoding="utf-8")
        logger.info("obsidian_note_written", path=rel_path)
        return full

    def append_to_note(self, rel_path: str, content: str) -> Path:
        full = self._resolve(rel_path)
        if full.exists():
            existing = full.read_text(encoding="utf-8")
            full.write_text(existing + "\n" + content, encoding="utf-8")
        else:
            self.write_note(rel_path, content)
        return full

    def write_from_template(
        self,
        template_name: str,
        rel_path: str,
        context: dict,
        overwrite: bool = False,
    ) -> Path:
        try:
            tmpl = self._jinja.get_template(template_name)
        except Exception:
            # Fallback to local template file
            tmpl_path = (
                Path(__file__).parent.parent / "obsidian" / "templates" / template_name
            )
            if not tmpl_path.exists():
                raise FileNotFoundError(f"Template not found: {template_name}")
            tmpl = self._jinja.from_string(tmpl_path.read_text())

        context.setdefault("date", datetime.now().strftime("%Y-%m-%d"))
        context.setdefault("time", datetime.now().strftime("%H:%M"))
        rendered = tmpl.render(**context)

        # Split frontmatter from body if template outputs ---\n...\n---
        try:
            post = frontmatter.loads(rendered)
            return self.write_note(
                rel_path, post.content, dict(post.metadata), overwrite=overwrite
            )
        except Exception:
            return self.write_note(rel_path, rendered, overwrite=overwrite)

    # ── Read ─────────────────────────────────────────────────────────────────

    def read_note(self, rel_path: str) -> Optional[ObsidianNote]:
        full = self._resolve(rel_path)
        if not full.exists():
            return None
        post = frontmatter.load(str(full))
        return ObsidianNote(full, dict(post.metadata), post.content)

    def search_notes(
        self,
        query: str,
        folder: Optional[str] = None,
        max_results: int = 20,
    ) -> list[ObsidianNote]:
        """Full-text search across the vault (case-insensitive substring match)."""
        search_root = self.root / folder if folder else self.root
        pattern = query.lower()
        results = []
        for md_file in sorted(search_root.rglob("*.md")):
            text = md_file.read_text(encoding="utf-8", errors="ignore").lower()
            if pattern in text:
                try:
                    post = frontmatter.load(str(md_file))
                    rel = str(md_file.relative_to(self.root))
                    results.append(ObsidianNote(md_file, dict(post.metadata), post.content))
                except Exception:
                    pass
            if len(results) >= max_results:
                break
        return results

    def list_notes(self, folder: str, recursive: bool = True) -> list[Path]:
        base = self._resolve(folder)
        if recursive:
            return list(base.rglob("*.md"))
        return list(base.glob("*.md"))

    # ── Client profile helpers ───────────────────────────────────────────────

    def client_note_path(self, client_id: str) -> str:
        return f"2-Areas/Clients/{client_id}.md"

    def create_client_profile(self, client, overwrite: bool = False) -> Path:
        from core.registry import Client  # avoid circular at module level
        return self.write_from_template(
            "client_profile.md",
            self.client_note_path(client.id),
            {
                "client": client,
                "title": client.name,
            },
            overwrite=overwrite,
        )

    def get_client_context(self, client_id: str) -> str:
        """Aggregate all vault content relevant to a client for LLM context."""
        notes = self.search_notes(client_id)
        if not notes:
            return ""
        chunks = []
        for note in notes[:10]:
            rel = str(note.path.relative_to(self.root))
            chunks.append(f"### {rel}\n{note.body[:1000]}")
        return "\n\n".join(chunks)

    # ── Research note helpers ────────────────────────────────────────────────

    def create_research_note(
        self,
        topic: str,
        content: str,
        sources: list[str] = None,
        client_id: Optional[str] = None,
        tags: Optional[list[str]] = None,
    ) -> Path:
        slug = re.sub(r"[^a-z0-9]+", "-", topic.lower()).strip("-")[:60]
        date_str = datetime.now().strftime("%Y-%m-%d")
        rel_path = f"3-Resources/Research/{date_str}-{slug}.md"
        metadata = {
            "title": topic,
            "date": date_str,
            "tags": tags or ["research"],
            "sources": sources or [],
        }
        if client_id:
            metadata["client"] = client_id
        body = content
        if sources:
            body += "\n\n## Sources\n" + "\n".join(f"- {s}" for s in sources)
        return self.write_note(rel_path, body, metadata)

    # ── Weekly dashboard ─────────────────────────────────────────────────────

    def update_weekly_dashboard(self, week_str: str, content: str) -> Path:
        rel = f"Maps/Weekly-Dashboard-{week_str}.md"
        return self.write_note(
            rel,
            content,
            {"title": f"Weekly Dashboard {week_str}", "tags": ["dashboard", "weekly"]},
            overwrite=True,
        )
