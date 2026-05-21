"""Tests for the self-improvement evaluator."""
import pytest

from self_improvement.evaluator import SkillEvaluator


@pytest.fixture
def evaluator(tmp_path):
    return SkillEvaluator(metrics_file=tmp_path / "metrics.json")


def test_empty_metrics(evaluator):
    m = evaluator.get_metrics("nonexistent-skill")
    assert m.total_executions == 0
    assert m.success_rate == 1.0
    assert m.needs_improvement is False


def test_record_success(evaluator):
    evaluator.record("my-skill", "exec1", True, 1.5)
    m = evaluator.get_metrics("my-skill")
    assert m.total_executions == 1
    assert m.success_count == 1
    assert m.success_rate == 1.0


def test_record_failure(evaluator):
    evaluator.record("my-skill", "exec1", False, 2.0, error="timeout")
    m = evaluator.get_metrics("my-skill")
    assert m.failure_count == 1
    assert m.success_rate == 0.0
    assert m.recent_errors == ["timeout"]


def test_needs_improvement_trigger(evaluator):
    # 10 executions, 70% success — should trigger improvement
    for i in range(7):
        evaluator.record("bad-skill", f"ok{i}", True, 1.0)
    for i in range(3):
        evaluator.record("bad-skill", f"fail{i}", False, 1.0, error="err")
    m = evaluator.get_metrics("bad-skill")
    assert m.total_executions == 10
    assert m.success_rate == pytest.approx(0.7)
    assert m.needs_improvement is True


def test_no_improvement_below_threshold(evaluator):
    # Only 5 executions — not enough to trigger
    for i in range(3):
        evaluator.record("ok-skill", f"ok{i}", True, 1.0)
    for i in range(2):
        evaluator.record("ok-skill", f"fail{i}", False, 1.0)
    m = evaluator.get_metrics("ok-skill")
    assert m.needs_improvement is False


def test_add_feedback(evaluator):
    evaluator.record("my-skill", "exec99", True, 1.0)
    ok = evaluator.add_feedback("exec99", 5, "Great output")
    assert ok is True
    m = evaluator.get_metrics("my-skill")
    assert m.avg_user_rating == 5.0


def test_feedback_not_found(evaluator):
    ok = evaluator.add_feedback("nonexistent", 4)
    assert ok is False


def test_list_skills(evaluator):
    evaluator.record("skill-a", "e1", True, 1.0)
    evaluator.record("skill-b", "e2", True, 1.0)
    assert set(evaluator.list_skills()) == {"skill-a", "skill-b"}


def test_persistence(tmp_path):
    mf = tmp_path / "metrics.json"
    ev1 = SkillEvaluator(metrics_file=mf)
    ev1.record("skill-x", "e1", True, 2.5)

    ev2 = SkillEvaluator(metrics_file=mf)
    m = ev2.get_metrics("skill-x")
    assert m.total_executions == 1
    assert m.avg_duration_s == pytest.approx(2.5)
