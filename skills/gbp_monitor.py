"""
GBP Monitor Skill

Analyzes Google Business Profile optimization status and produces
a scored assessment with prioritized action items.
"""
from core.registry import Client
from skills.base import SkillBase

SYSTEM = """\
You are a Google Business Profile optimization expert.
Score each element objectively. Be specific about what's missing and why it matters.
Your action items must be implementable the same day they're read."""

PROMPT = """\
Client: {client_context}
GBP Profile URL: {gbp_url}
GBP Place ID: {place_id}
Primary Category: {primary_category}

Perform a GBP optimization audit. For each element, give a score 0-10 and specific notes.

## Scoring Rubric
Score each element:
| Element | Score (0-10) | Issue | Fix |
|---------|-------------|-------|-----|
| Business Name (keyword use) | | | |
| Primary Category | | | |
| Secondary Categories | | | |
| Description (keywords, CTA) | | | |
| Address/Service Area | | | |
| Phone | | | |
| Website Link | | | |
| Hours | | | |
| Photos (count + quality) | | | |
| Posts (frequency + type) | | | |
| Q&A Section | | | |
| Review Response Rate | | | |
| Review Velocity | | | |
| Products/Services | | | |
| Attributes | | | |

## Overall GBP Health Score: X/150

## Top 5 Quick Wins (implementable this week):
1.
2.
3.
4.
5.

## 90-Day GBP Roadmap:
(Month 1 / Month 2 / Month 3 priorities)

## Review Strategy:
- Current velocity estimate:
- Target velocity:
- Best 3 touchpoints to request reviews:"""


class GBPMonitorSkill(SkillBase):
    name = "gbp-monitor"
    description = "Scores GBP optimization across 15 elements and produces a 90-day roadmap."

    def _run(self, client: Client, **params) -> str:
        prompt = PROMPT.format(
            client_context=client.to_context_string(),
            gbp_url=client.gbp.profile_url or "(GBP profile URL not configured)",
            place_id=client.gbp.place_id or "(not set)",
            primary_category=client.gbp.primary_category or "(not set)",
        )
        return self.anthropic.complete(prompt, system=SYSTEM, max_tokens=3000)
