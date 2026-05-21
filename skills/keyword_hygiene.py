"""
Keyword Hygiene Skill

Audits keyword strategy for a local business and produces:
- Expanded keyword map with search intent labels
- Gap analysis vs likely competitors
- GBP and on-site optimization targets
"""
from core.registry import Client
from skills.base import SkillBase

SYSTEM = """\
You are a local keyword strategy expert. Your output is always structured,
specific, and actionable. You understand local search intent, map pack triggers,
and how keywords map to GBP categories vs website pages."""

PROMPT = """\
Client: {client_context}

Perform a keyword hygiene audit.

## 1. Keyword Expansion Map
Build a keyword map organized by intent. Include estimated monthly search volume tier (High/Med/Low):

| Keyword | Intent | Volume Tier | Target Page | Priority |
|---------|--------|-------------|-------------|----------|
(include at least 15 keywords across all intent types)

Intent categories:
- Navigational (branded)
- Informational ("how to", "best", "what is")
- Local Transactional ("near me", "in {city}")
- Service-Specific Transactional

## 2. Gap Analysis
Top 5 keyword gaps this business is likely missing based on their niche:
1.
2.
3.
4.
5.

## 3. GBP Keyword Targets
- Primary category keyword to target:
- Best secondary categories to add:
- Business description keyword density targets:
- Top 3 service names to add to GBP services section:

## 4. Featured Snippet Opportunities
3 questions this business could answer to capture PAA/featured snippets:
1.
2.
3.

## 5. Hygiene Issues to Fix
(cannibalization, keyword stuffing, missing modifiers, etc.)"""


class KeywordHygieneSkill(SkillBase):
    name = "keyword-hygiene"
    description = "Keyword map expansion, gap analysis, and GBP keyword targeting."

    def _run(self, client: Client, **params) -> str:
        prompt = PROMPT.format(
            client_context=client.to_context_string(),
        )
        return self.anthropic.complete(prompt, system=SYSTEM, max_tokens=3500)
