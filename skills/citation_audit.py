"""
Citation Audit Skill

Produces a prioritised citation audit for a local business:
- Identifies critical directories by niche + location
- Honors per-client overrides (citation_audit_skip)
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

Target citation directories: {target_dirs}
Directories to skip (per client override): {skip_dirs}

Task: Perform a comprehensive citation audit analysis.

Output (in this exact order):
1. **Executive Summary** (3 sentences max: current risk level, biggest gap, top priority)
2. **Critical Directories for This Niche + Location** (table: Directory | URL | Priority | NAP Match Risk)
3. **NAP Risk Assessment** (common inconsistency patterns for this business type)
4. **Action Plan**
   - P1 — Fix immediately (citation errors that hurt rankings now)
   - P2 — Build within 30 days (missing high-authority citations)
   - P3 — Nice to have (supplemental/niche-specific)
5. **Monitoring Checklist** (5 bullet points to check monthly)

Be specific to {business_type} in {city}, {state}.
Do NOT include any directories listed in the skip list."""


class CitationAuditSkill(SkillBase):
    name = "citation-audit"
    description = "Generates a prioritized citation audit with P1/P2/P3 action plan. Honors per-client overrides."

    def _run(self, client: Client, **params) -> str:
        target = client.citations.target_directories
        skip = client.overrides.get("citation_audit_skip", [])
        effective = [d for d in target if d not in skip] if target else []

        prompt = PROMPT.format(
            client_context=client.to_context_string(),
            target_dirs=", ".join(effective) if effective else "all major directories for this niche",
            skip_dirs=", ".join(skip) if skip else "none",
            business_type=client.business_type or client.industry or "local business",
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
