"""
FeedbackLoop — automated improvement cycle.

Runs periodically (or on demand) to:
1. Find skills that need improvement (below success threshold)
2. Generate analysis for each
3. Stage improved versions for operator review
4. Optionally notify via console summary

Can be triggered via `jarvis improve run`.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from core.config import settings
from core.logger import logger
from self_improvement.evaluator import SkillEvaluator, SkillMetrics
from self_improvement.optimizer import SkillOptimizer, SkillVersion


@dataclass
class ImprovementCycleResult:
    run_at: str
    skills_evaluated: int
    skills_improved: int
    improvements: list[dict]
    summary: str


class FeedbackLoop:
    def __init__(self):
        self._evaluator = SkillEvaluator()
        self._optimizer = SkillOptimizer()

    def run(self, force_skills: Optional[list[str]] = None) -> ImprovementCycleResult:
        """
        Run a full improvement cycle.

        force_skills: if provided, run improvement for these skills regardless of metrics.
        """
        if force_skills:
            target_metrics = [self._evaluator.get_metrics(s) for s in force_skills]
        else:
            target_metrics = self._evaluator.skills_needing_improvement()

        improvements = []
        for metrics in target_metrics:
            logger.info("improvement_cycle_skill", skill=metrics.skill)
            try:
                version = self._optimizer.generate_improved_version(metrics.skill)
                improvements.append({
                    "skill": metrics.skill,
                    "version": version.version,
                    "success_rate_before": metrics.success_rate,
                    "total_executions": metrics.total_executions,
                    "staged_at": version.created_at,
                })
            except Exception as exc:
                logger.error("improvement_cycle_error", skill=metrics.skill, exc=str(exc))

        summary_lines = [
            f"Improvement cycle — {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            f"Skills evaluated: {len(target_metrics)}",
            f"Improvements staged: {len(improvements)}",
        ]
        for imp in improvements:
            summary_lines.append(
                f"  • {imp['skill']}: v{imp['version']} staged "
                f"(was {imp['success_rate_before']:.0%} success over {imp['total_executions']} runs)"
            )
        if not improvements:
            summary_lines.append("  All skills meeting performance thresholds — nothing to improve.")

        summary = "\n".join(summary_lines)
        return ImprovementCycleResult(
            run_at=datetime.now().isoformat(),
            skills_evaluated=len(target_metrics),
            skills_improved=len(improvements),
            improvements=improvements,
            summary=summary,
        )

    def quick_feedback(self, execution_id: str, rating: int, notes: str = "") -> bool:
        """Let the user rate a specific execution. Called after `jarvis skill run`."""
        return self._evaluator.add_feedback(execution_id, rating, notes)
