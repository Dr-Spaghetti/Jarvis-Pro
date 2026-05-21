"""
SEOAgent — runs structured SEO analysis tasks for a given client.

Handles: citation audits, GBP analysis, keyword gap analysis,
competitor comparisons, and action-item generation.
"""
from typing import Optional

from agents.base_agent import BaseAgent
from core.logger import logger
from core.registry import Client

SEO_SYSTEM = """\
You are Jarvis, an expert local SEO analyst. You produce clear, data-driven
analysis and actionable recommendations. Be specific — generic SEO advice is
worthless. Focus on what will move rankings in map packs and local organic results."""

CITATION_AUDIT_PROMPT = """\
Client: {client_context}

Perform a citation audit analysis. Based on the client information above:

1. Identify the critical citation directories for their business type and location
2. Flag common NAP (Name, Address, Phone) inconsistency patterns to watch for
3. List the top 15 citation sources to verify/build for this specific niche+location combo
4. Provide a priority-ranked action list (P1 = fix immediately, P2 = next 30 days, P3 = nice to have)

Format as structured Markdown with clear sections."""

KEYWORD_GAP_PROMPT = """\
Client: {client_context}

Analyze keyword opportunities for this local business.

Primary keyword: {primary_keyword}
Location: {location}

1. Identify 10 high-value keyword variants (include local modifiers, service variants, intent variants)
2. Flag any obvious gaps in their current keyword strategy
3. Suggest 3 featured-snippet or PAA opportunities
4. Recommend internal linking anchors for their GBP description

Format as a table where appropriate."""

GBP_ANALYSIS_PROMPT = """\
Client: {client_context}

Analyze their Google Business Profile optimization opportunities.

1. Score each GBP element (0-10): name, categories, description, photos, posts, Q&A, reviews
2. List the top 5 GBP optimizations that would move the needle most in the next 90 days
3. Suggest a 4-week GBP post calendar with topics
4. Review velocity recommendation (reviews/month target)

Be specific to their business type and location."""


class SEOAgent(BaseAgent):
    name = "seo"
    description = "Local SEO analysis agent. Runs citation audits, keyword analysis, GBP optimization, and competitor comparisons."

    def _execute(self, task: str, **kwargs) -> str:
        client: Optional[Client] = kwargs.get("client")
        task_type = kwargs.get("task_type", "general")

        client_ctx = client.to_context_string() if client else "No client specified"

        if task_type == "citation_audit":
            prompt = CITATION_AUDIT_PROMPT.format(client_context=client_ctx)
        elif task_type == "keyword_gap":
            prompt = KEYWORD_GAP_PROMPT.format(
                client_context=client_ctx,
                primary_keyword=client.primary_keyword if client else task,
                location=client.location_str if client else "unknown",
            )
        elif task_type == "gbp_analysis":
            prompt = GBP_ANALYSIS_PROMPT.format(client_context=client_ctx)
        else:
            prompt = f"Task: {task}\n\nClient context:\n{client_ctx}"

        return self._simple_complete(prompt, system=SEO_SYSTEM, max_tokens=3000)

    # ── Convenience methods ──────────────────────────────────────────────────

    def citation_audit(self, client: Client) -> str:
        result = self.run("Citation audit", client=client, task_type="citation_audit")
        return result.output or result.error

    def keyword_gap(self, client: Client) -> str:
        result = self.run("Keyword gap analysis", client=client, task_type="keyword_gap")
        return result.output or result.error

    def gbp_analysis(self, client: Client) -> str:
        result = self.run("GBP analysis", client=client, task_type="gbp_analysis")
        return result.output or result.error
