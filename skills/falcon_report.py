"""
Local Falcon Report Skill

Pulls the latest Local Falcon scan data for a client and generates
a narrative weekly report with trend analysis and recommendations.
"""
from datetime import datetime

from core.logger import logger
from core.registry import Client
from skills.base import SkillBase

SYSTEM = """\
You are a local SEO analyst interpreting Local Falcon grid scan data.
Write in a clear, professional style that a small business owner can understand.
Lead with what changed, then explain why it matters, then tell them what to do."""

PROMPT_WITH_DATA = """\
Client: {client_name}
Location: {location}
Primary keyword: {primary_keyword}
Report date: {date}

Local Falcon Data:
{falcon_data}

Write a weekly Local Falcon report covering:
1. **This Week's Snapshot** (avg rank, top-3%, top-10% — vs last week if available)
2. **Grid Performance** (which directions/quadrants are strong vs weak)
3. **Trend Analysis** (improving / declining / stable — and why)
4. **Top 3 Action Items** (specific things to do this week to improve map pack visibility)
5. **30-Day Outlook** (what to expect if actions are taken)

Keep it under 500 words. Be direct."""

PROMPT_NO_FALCON = """\
Client: {client_name}
Location: {location}
Primary keyword: {primary_keyword}

Local Falcon is not yet configured for this client (no local_falcon_id set).

Generate a Local Falcon setup checklist and explain what they can expect to learn
from their first scan. Include:
1. Setup steps (create scan, choose grid size, set keyword)
2. What baseline metrics to record
3. How to interpret their first report
4. What a "good" result looks like for their business type"""


class FalconReportSkill(SkillBase):
    name = "falcon-report"
    description = "Generates a weekly Local Falcon report with trend analysis and action items."

    def _run(self, client: Client, **params) -> str:
        date = datetime.now().strftime("%Y-%m-%d")

        if not client.has_local_falcon:
            logger.info("falcon_report_no_id", client=client.id)
            prompt = PROMPT_NO_FALCON.format(
                client_name=client.name,
                location=client.location_str,
                primary_keyword=client.primary_keyword or "(not set)",
            )
            return self.anthropic.complete(prompt, system=SYSTEM, max_tokens=2000)

        # Attempt to fetch real data
        falcon_data = self._fetch_falcon_data(client)
        prompt = PROMPT_WITH_DATA.format(
            client_name=client.name,
            location=client.location_str,
            primary_keyword=client.primary_keyword,
            date=date,
            falcon_data=falcon_data,
        )
        return self.anthropic.complete(prompt, system=SYSTEM, max_tokens=2000)

    def _fetch_falcon_data(self, client: Client) -> str:
        try:
            from integrations.local_falcon import LocalFalconClient
            from core.config import settings
            if not settings.has_local_falcon:
                return "(LOCAL_FALCON_API_KEY not configured — using placeholder data)"
            fc = LocalFalconClient()
            summary = fc.summarize_latest_scan(client.integrations.local_falcon_id)
            trend = fc.get_trend_report(client.integrations.local_falcon_id, days=30)
            return f"{summary}\n\nTrend (30 days): {trend}"
        except Exception as exc:
            logger.warning("falcon_fetch_failed", client=client.id, exc=str(exc))
            return f"(Data fetch failed: {exc})"

    def _save_to_vault(self, client: Client, result):
        if self._vault and result.output:
            date = datetime.now().strftime("%Y-%m-%d")
            rel = f"2-Areas/SEO-Research/falcon-{client.id}-{date}.md"
            return self._vault.write_note(
                rel,
                result.output,
                metadata={
                    "title": f"Falcon Report — {client.name} — {date}",
                    "client": client.id,
                    "date": date,
                    "tags": ["falcon-report", "rankings", client.id],
                },
            )
