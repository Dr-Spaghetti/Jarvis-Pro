"""
Research Harness — the core of Jarvis-Pro's intelligence layer.

Orchestrates multi-source research using a Claude tool-use loop:
  1. Accepts a natural-language research question
  2. Runs a tool-use loop where Claude decides which sources to query
  3. Synthesizes all findings into a structured Markdown document
  4. Optionally saves to the Obsidian vault and caches the result

Available tools in the loop:
  web_search         → Brave Search or DuckDuckGo
  vault_search       → Obsidian full-text search
  read_vault_note    → Read a specific vault note
  get_client_context → Pull aggregated client info
  store_finding      → Bookmark an insight mid-research
"""
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from core.config import settings
from core.logger import logger
from integrations.anthropic_client import JarvisAnthropicClient
from research.memory import ResearchMemory
from research.sources import get_web_source
from research.synthesizer import synthesize


@dataclass
class ResearchResult:
    topic: str
    summary: str
    sources: list[str] = field(default_factory=list)
    findings: list[dict] = field(default_factory=list)
    vault_path: Optional[str] = None
    cached: bool = False

    def to_dict(self) -> dict:
        return {
            "topic": self.topic,
            "summary": self.summary,
            "sources": self.sources,
            "findings": self.findings,
            "vault_path": self.vault_path,
            "cached": self.cached,
        }


RESEARCH_SYSTEM = """\
You are Jarvis, an AI research assistant for a local SEO agency.
When given a research question, use the available tools to gather information
from multiple sources before synthesizing your findings.

Strategy:
1. Start with web_search for current information
2. Use vault_search to check if we have prior research on this topic
3. For client-specific questions, call get_client_context first
4. Use store_finding to bookmark important insights as you find them
5. When you have enough information (or after {max_searches} searches), stop and summarize

Be thorough but efficient. Prefer recent, authoritative sources."""

RESEARCH_TOOLS = [
    {
        "name": "web_search",
        "description": "Search the web for current information. Use for factual queries, recent news, algorithm updates, and competitive research.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Specific search query"},
                "num_results": {"type": "integer", "default": 5, "minimum": 1, "maximum": 10},
            },
            "required": ["query"],
        },
    },
    {
        "name": "vault_search",
        "description": "Search the Obsidian knowledge vault for existing notes and prior research.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "folder": {
                    "type": "string",
                    "description": "Optional subfolder to search in (e.g. '2-Areas/Clients')",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "read_vault_note",
        "description": "Read the full content of a specific Obsidian vault note by its relative path.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path from vault root, e.g. '2-Areas/Clients/kaplunmarx.md'",
                }
            },
            "required": ["path"],
        },
    },
    {
        "name": "get_client_context",
        "description": "Get aggregated information about a specific client from the registry and vault.",
        "input_schema": {
            "type": "object",
            "properties": {
                "client_id": {"type": "string", "description": "Client slug ID from the registry"}
            },
            "required": ["client_id"],
        },
    },
    {
        "name": "store_finding",
        "description": "Bookmark an important finding or insight during research. Call this when you find something worth preserving.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "content": {"type": "string"},
                "source_url": {"type": "string", "default": ""},
                "importance": {
                    "type": "string",
                    "enum": ["high", "medium", "low"],
                    "default": "medium",
                },
            },
            "required": ["title", "content"],
        },
    },
]


class ResearchHarness:
    def __init__(self, vault=None, registry=None):
        self._anthropic = JarvisAnthropicClient(model=settings.research_model)
        self._web = get_web_source()
        self._memory = ResearchMemory()
        self._vault = vault
        self._registry = registry
        self._findings: list[dict] = []

    # ── Public API ───────────────────────────────────────────────────────────

    def research(
        self,
        topic: str,
        context: str = "",
        depth: int = None,
        client_id: Optional[str] = None,
        save_to_vault: bool = True,
        use_cache: bool = True,
    ) -> ResearchResult:
        """Run the full research pipeline for a topic."""
        depth = depth or settings.max_research_depth

        # Check cache
        if use_cache:
            cached = self._memory.get(topic)
            if cached:
                logger.info("research_cache_hit", topic=topic)
                return ResearchResult(cached=True, **cached)

        logger.info("research_start", topic=topic, depth=depth)
        self._findings = []

        # Build tool handler with closure over instance state
        def handle_tool(name: str, inp: dict) -> str:
            return json.dumps(self._dispatch_tool(name, inp))

        # Build initial message
        context_note = f"\n\nClient context:\n{context}" if context else ""
        if client_id and self._registry:
            client = self._registry.get(client_id)
            if client:
                context_note += f"\n\nClient: {client.to_context_string()}"

        messages = [
            {
                "role": "user",
                "content": f"Research question: {topic}{context_note}\n\nPlease research this thoroughly, then provide a comprehensive summary of your findings.",
            }
        ]
        system = RESEARCH_SYSTEM.format(max_searches=depth * 3)

        final_text, _ = self._anthropic.tool_loop(
            messages=messages,
            tools=RESEARCH_TOOLS,
            system=system,
            max_turns=depth * 5,
            tool_handler=handle_tool,
        )

        # Synthesize all gathered findings
        synth = synthesize(topic, self._findings, context=context)
        full_summary = final_text or synth["summary"]

        result = ResearchResult(
            topic=topic,
            summary=full_summary,
            sources=synth["sources"],
            findings=list(self._findings),
        )

        # Write to vault
        if save_to_vault and self._vault:
            try:
                path = self._vault.create_research_note(
                    topic,
                    full_summary,
                    sources=synth["sources"],
                    client_id=client_id,
                )
                result.vault_path = str(path)
                logger.info("research_saved_to_vault", path=result.vault_path)
            except Exception as exc:
                logger.warning("research_vault_write_failed", exc=str(exc))

        # Cache
        self._memory.store(topic, result.to_dict())
        logger.info("research_complete", topic=topic, findings=len(self._findings))
        return result

    # ── Tool dispatcher ──────────────────────────────────────────────────────

    def _dispatch_tool(self, name: str, inp: dict) -> dict:
        if name == "web_search":
            results = self._web.search(inp["query"], inp.get("num_results", 5))
            self._findings.extend(results)
            return {"results": results}

        if name == "vault_search":
            if not self._vault:
                return {"error": "Vault not configured"}
            notes = self._vault.search_notes(inp["query"], folder=inp.get("folder"))
            return {
                "notes": [
                    {"path": str(n.path.name), "title": n.title, "excerpt": n.body[:400]}
                    for n in notes
                ]
            }

        if name == "read_vault_note":
            if not self._vault:
                return {"error": "Vault not configured"}
            note = self._vault.read_note(inp["path"])
            if not note:
                return {"error": f"Note not found: {inp['path']}"}
            return {"title": note.title, "content": note.body[:3000]}

        if name == "get_client_context":
            if not self._registry:
                return {"error": "Registry not loaded"}
            client = self._registry.get(inp["client_id"])
            if not client:
                return {"error": f"Client not found: {inp['client_id']}"}
            ctx = client.to_context_string()
            if self._vault:
                ctx += "\n\n" + self._vault.get_client_context(inp["client_id"])
            return {"context": ctx}

        if name == "store_finding":
            self._findings.append({
                "title": inp["title"],
                "snippet": inp["content"],
                "url": inp.get("source_url", ""),
                "importance": inp.get("importance", "medium"),
            })
            return {"stored": True}

        return {"error": f"Unknown tool: {name}"}
