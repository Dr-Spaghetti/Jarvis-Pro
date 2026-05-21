"""Tests for skills base and registry."""
import pytest
from unittest.mock import MagicMock, patch

from core.registry import Client
from skills import SKILL_REGISTRY
from skills.base import SkillBase, SkillResult


@pytest.fixture
def sample_client():
    return Client(
        id="test-plumber",
        name="Dallas Plumbing Co",
        business_type="Plumber",
        primary_keyword="plumber dallas",
        city="Dallas",
        state="TX",
    )


def test_skill_registry_not_empty():
    assert len(SKILL_REGISTRY) > 0


def test_all_skills_have_name():
    for key, cls in SKILL_REGISTRY.items():
        assert cls.name, f"{key} missing .name"
        assert cls.description, f"{key} missing .description"


def test_skill_result_str(sample_client):
    r = SkillResult(
        skill="test",
        client_id=sample_client.id,
        client_name=sample_client.name,
        success=True,
        output="done",
        duration_s=1.5,
    )
    assert "OK" in str(r)
    assert "test" in str(r)


def test_skill_result_fail_str(sample_client):
    r = SkillResult(
        skill="test",
        client_id=sample_client.id,
        client_name=sample_client.name,
        success=False,
        output=None,
        error="api error",
    )
    assert "FAIL" in str(r)


class ConcreteSkill(SkillBase):
    name = "test-skill"
    description = "A test skill"

    def _run(self, client, **params):
        return f"Result for {client.name}"


def test_skill_run_success(sample_client):
    with patch("self_improvement.evaluator.SkillEvaluator.record"):
        skill = ConcreteSkill()
        result = skill.run(sample_client)
    assert result.success is True
    assert "Dallas Plumbing Co" in result.output
    assert result.execution_id
    assert result.duration_s >= 0


def test_skill_run_records_metric(sample_client):
    with patch("self_improvement.evaluator.SkillEvaluator.record") as mock_record:
        skill = ConcreteSkill()
        result = skill.run(sample_client)
        mock_record.assert_called_once()
        call_kwargs = mock_record.call_args.kwargs
        assert call_kwargs["skill"] == "test-skill"
        assert call_kwargs["success"] is True


class FailingSkill(SkillBase):
    name = "failing-skill"
    description = "Always fails"

    def _run(self, client, **params):
        raise ValueError("intentional failure")


def test_skill_run_failure(sample_client):
    with patch("self_improvement.evaluator.SkillEvaluator.record"):
        skill = FailingSkill()
        result = skill.run(sample_client)
    assert result.success is False
    assert result.error == "intentional failure"
    assert result.output is None


def test_skill_citation_audit_has_correct_name():
    from skills.citation_audit import CitationAuditSkill
    assert CitationAuditSkill.name == "citation-audit"


def test_skill_falcon_report_has_correct_name():
    from skills.falcon_report import FalconReportSkill
    assert FalconReportSkill.name == "falcon-report"


def test_skill_gbp_monitor_has_correct_name():
    from skills.gbp_monitor import GBPMonitorSkill
    assert GBPMonitorSkill.name == "gbp-monitor"


def test_skill_keyword_hygiene_has_correct_name():
    from skills.keyword_hygiene import KeywordHygieneSkill
    assert KeywordHygieneSkill.name == "keyword-hygiene"
