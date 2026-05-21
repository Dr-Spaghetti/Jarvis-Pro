"""
Citation Audit Skill

Produces a prioritised citation audit for a local business:
- Identifies critical directories by niche + location
- Flags NAP inconsistency risk factors
- Outputs a P1/P2/P3 action plan
"""
from core.registry import Client
from skills.base import SkillBase

SYSTEM = """\
You are an expert local SEO citation specialist. You produce precise,
actionable citation audits. Your output is always structured Markdown
that an agency operator can hand directly to a client or act on immediately.
No padding, no generic advice — be specific to the business, niche, and city."""

PROMPT = """\
Client brief:
{client_context}

Task: Perform a comprehensive citation audit analysis.

Output (in this exact order):
1. **Executive Summary** (3 sentences max: current risk level, biggest gap, top priority)
2. **Critical Directories for This Niche + Location** (table: Directory | URL | Priority | Status hint)
3. **NAP Risk Assessment** (common inconsistency patterns for this business type)
4. **Action Plan**
   - P1 — Fix immediately (citation errors that hurt rankings now)
   - P2 — Build within 30 days (missing high-authority citations)
   - P3 — Nice to have (supplemental/niche-specific)
5. **Monitoring Checklist** (5 bullet points to check monthly)

Be specific to {business_type} in {city}, {state}."""


class CitationAuditSkill(SkillBase):
    name = "citation-audit"
    description = "Generates a prioritized citation audit with P1/P2/P3 action plan."

    def _run(self, client: Client, **params) -> str:
        prompt = PROMPT.format(
            client_context=client.to_context_string(),
            business_type=client.business_type or "local business",
            city=client.city or "unknown city",
            state=client.state or "unknown state",
        )
        return self.anthropic.complete(prompt, system=SYSTEM, max_tokens=3000)

    def _save_to_vault(self, client: Client, result):
        if self._vault and result.output:
            from datetime import datetime
            date = datetime.now().strftime("%Y-%m-%d")
            rel = f"1-Projects/{client.id}/citation-audit-{date}.md"
            return self._vault.write_note(
                rel,
                result.output,
                metadata={
                    "title": f"Citation Audit — {client.name}",
                    "client": client.id,
                    "date": date,
                    "tags": ["citation-audit", "seo", client.id],
                },
            )
