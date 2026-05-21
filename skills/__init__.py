from skills.base import SkillBase, SkillResult
from skills.citation_audit import CitationAuditSkill
from skills.falcon_report import FalconReportSkill
from skills.gbp_monitor import GBPMonitorSkill
from skills.keyword_hygiene import KeywordHygieneSkill

SKILL_REGISTRY: dict[str, type] = {
    "citation-audit": CitationAuditSkill,
    "falcon-report": FalconReportSkill,
    "gbp-monitor": GBPMonitorSkill,
    "keyword-hygiene": KeywordHygieneSkill,
}

__all__ = [
    "SkillBase", "SkillResult", "SKILL_REGISTRY",
    "CitationAuditSkill", "FalconReportSkill",
    "GBPMonitorSkill", "KeywordHygieneSkill",
]
