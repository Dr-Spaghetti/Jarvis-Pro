"""
SkillEvaluator — records and analyses every agent/skill execution.

Writes to .jarvis/metrics.json. Provides:
- Per-skill success rate, avg duration, error frequency
- Identification of underperforming skills
- Raw history for the optimizer to reason about
"""
import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

from core.config import settings
from core.logger import logger


@dataclass
class ExecutionRecord:
    skill: str
    execution_id: str
    success: bool
    duration_s: float
    timestamp: str
    error: Optional[str] = None
    client_id: Optional[str] = None
    user_rating: Optional[int] = None  # 1-5 stars, set later via feedback
    user_notes: Optional[str] = None


@dataclass
class SkillMetrics:
    skill: str
    total_executions: int
    success_count: int
    failure_count: int
    success_rate: float
    avg_duration_s: float
    avg_user_rating: Optional[float]
    recent_errors: list[str]
    needs_improvement: bool

    @property
    def health_emoji(self) -> str:
        if self.success_rate >= 0.9:
            return "green"
        if self.success_rate >= 0.75:
            return "yellow"
        return "red"


class SkillEvaluator:
    def __init__(self, metrics_file: Optional[Path] = None):
        self._file = metrics_file or settings.metrics_file
        self._records: list[ExecutionRecord] = []
        self._load()

    def _load(self):
        if self._file.exists():
            try:
                raw = json.loads(self._file.read_text())
                self._records = [ExecutionRecord(**r) for r in raw]
            except Exception as exc:
                logger.warning("metrics_load_failed", exc=str(exc))
                self._records = []

    def _save(self):
        self._file.parent.mkdir(parents=True, exist_ok=True)
        self._file.write_text(
            json.dumps([asdict(r) for r in self._records], indent=2)
        )

    # ── Write ────────────────────────────────────────────────────────────────

    def record(
        self,
        skill: str,
        execution_id: str,
        success: bool,
        duration_s: float,
        error: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> ExecutionRecord:
        rec = ExecutionRecord(
            skill=skill,
            execution_id=execution_id,
            success=success,
            duration_s=duration_s,
            timestamp=datetime.now().isoformat(),
            error=error,
            client_id=client_id,
        )
        self._records.append(rec)
        self._save()
        return rec

    def add_feedback(self, execution_id: str, rating: int, notes: str = "") -> bool:
        """Add user feedback to an existing execution record. rating = 1-5."""
        for rec in self._records:
            if rec.execution_id == execution_id:
                rec.user_rating = max(1, min(5, rating))
                rec.user_notes = notes
                self._save()
                return True
        return False

    # ── Read ─────────────────────────────────────────────────────────────────

    def get_metrics(self, skill: str) -> SkillMetrics:
        records = [r for r in self._records if r.skill == skill]
        if not records:
            return SkillMetrics(
                skill=skill,
                total_executions=0,
                success_count=0,
                failure_count=0,
                success_rate=1.0,
                avg_duration_s=0.0,
                avg_user_rating=None,
                recent_errors=[],
                needs_improvement=False,
            )
        successes = [r for r in records if r.success]
        failures = [r for r in records if not r.success]
        rated = [r for r in records if r.user_rating is not None]
        avg_rating = sum(r.user_rating for r in rated) / len(rated) if rated else None
        recent_errors = [r.error for r in failures[-5:] if r.error]
        success_rate = len(successes) / len(records)
        needs_improvement = (
            len(records) >= settings.improvement_min_executions
            and success_rate < settings.improvement_success_threshold
        ) or (avg_rating is not None and avg_rating < 3.5)

        return SkillMetrics(
            skill=skill,
            total_executions=len(records),
            success_count=len(successes),
            failure_count=len(failures),
            success_rate=round(success_rate, 3),
            avg_duration_s=round(sum(r.duration_s for r in records) / len(records), 2),
            avg_user_rating=round(avg_rating, 2) if avg_rating else None,
            recent_errors=recent_errors,
            needs_improvement=needs_improvement,
        )

    def list_skills(self) -> list[str]:
        return sorted({r.skill for r in self._records})

    def skills_needing_improvement(self) -> list[SkillMetrics]:
        return [
            m for m in (self.get_metrics(s) for s in self.list_skills())
            if m.needs_improvement
        ]

    def recent_history(self, skill: str, n: int = 20) -> list[dict]:
        records = [r for r in self._records if r.skill == skill][-n:]
        return [asdict(r) for r in records]

    def all_metrics(self) -> list[SkillMetrics]:
        return [self.get_metrics(s) for s in self.list_skills()]
