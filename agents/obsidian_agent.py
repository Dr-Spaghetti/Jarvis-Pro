"""
ObsidianAgent — manages the knowledge vault.

Responsibilities:
- Sync client profiles from registry to vault
- Rebuild dashboard notes
- Organize and tag notes
- Generate Map of Content (MOC) notes
- Surface stale/unlinked notes
"""
from datetime import datetime
from typing import Optional

from agents.base_agent import BaseAgent
from core.logger import logger
from core.registry import Client

MOC_SYSTEM = """\
You are a knowledge architect helping organize an Obsidian vault for a local SEO agency.
Generate clean, well-structured Map of Content notes that help navigate the knowledge base.
Use Obsidian [[wikilink]] syntax for internal links. Group related topics logically."""

DASHBOARD_PROMPT = """\
Date: {date}
Active clients: {client_count}
Client list:
{client_list}

Generate a weekly dashboard Markdown note for an SEO agency operator.
Include:
- Week at a glance (key metrics to check)
- Client status table (Name | Priority | Next Action | Due Date)
- This week's focus areas
- Dataview query block for finding notes tagged #action-needed
- Quick links to each client profile

Use Obsidian-flavored Markdown. Include a Dataview query:
```dataview
TABLE primary_keyword, city, updated_at
FROM "2-Areas/Clients"
SORT file.name ASC
```
"""


class ObsidianAgent(BaseAgent):
    name = "obsidian"
    description = "Obsidian vault management agent. Syncs clients, builds dashboards, maintains MOC notes."

    def _execute(self, task: str, **kwargs) -> str:
        action = kwargs.get("action", "sync")
        if action == "sync_clients":
            return self._sync_clients()
        if action == "dashboard":
            return self._build_dashboard()
        if action == "client_moc":
            return self._build_client_moc()
        return f"Unknown action: {action}"

    # ── Actions ──────────────────────────────────────────────────────────────

    def _sync_clients(self) -> str:
        if not self._vault or not self._registry:
            return "vault and registry required for sync"
        clients = self._registry.list(active_only=False)
        created, updated, skipped = [], [], []
        for client in clients:
            path = self._vault.client_note_path(client.id)
            note = self._vault.read_note(path)
            if note is None:
                self._vault.create_client_profile(client, overwrite=False)
                created.append(client.name)
            else:
                # Update the "updated_at" frontmatter but preserve body edits
                skipped.append(client.name)
        summary_parts = []
        if created:
            summary_parts.append(f"Created: {', '.join(created)}")
        if updated:
            summary_parts.append(f"Updated: {', '.join(updated)}")
        if skipped:
            summary_parts.append(f"Skipped (exists): {', '.join(skipped)}")
        return " | ".join(summary_parts) or "Nothing to sync"

    def _build_dashboard(self) -> str:
        if not self._vault or not self._registry:
            return "vault and registry required"
        clients = self._registry.list(active_only=True)
        client_lines = "\n".join(
            f"- {c.name} ({c.city}, {c.state}) — {c.primary_keyword}" for c in clients
        )
        prompt = DASHBOARD_PROMPT.format(
            date=datetime.now().strftime("%Y-%m-%d"),
            client_count=len(clients),
            client_list=client_lines,
        )
        content = self._simple_complete(prompt, system=MOC_SYSTEM, max_tokens=2000)
        week_str = datetime.now().strftime("%Y-W%V")
        path = self._vault.update_weekly_dashboard(week_str, content)
        return f"Dashboard written to {path}"

    def _build_client_moc(self) -> str:
        if not self._vault or not self._registry:
            return "vault and registry required"
        clients = self._registry.list(active_only=True)
        lines = [
            "# Client Map of Content\n",
            f"*Auto-generated — {datetime.now().strftime('%Y-%m-%d')}*\n",
            "",
            "## Active Clients\n",
        ]
        for c in clients:
            lines.append(f"- [[{c.id}|{c.name}]] — {c.business_type} — {c.location_str}")
        content = "\n".join(lines)
        self._vault.write_note("Maps/Client-MOC.md", content, overwrite=True)
        return f"Client MOC updated with {len(clients)} clients"

    # ── Surface stale notes ──────────────────────────────────────────────────

    def find_orphan_notes(self, folder: str = "3-Resources/Research") -> list[str]:
        """Return paths of notes with no outbound wikilinks."""
        if not self._vault:
            return []
        orphans = []
        for note_path in self._vault.list_notes(folder):
            body = note_path.read_text(errors="ignore")
            if "[[" not in body:
                rel = str(note_path.relative_to(self._vault.root))
                orphans.append(rel)
        return orphans
