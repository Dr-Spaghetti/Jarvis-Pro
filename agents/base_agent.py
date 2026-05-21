"""
BaseAgent — parent class for all Jarvis agents.

Provides:
- Execution timing and metric recording
- Self-evaluation hooks (called post-run)
- Uniform result envelope
- Access to shared services (anthropic client, vault, registry)
"""
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from core.config import settings
from core.logger import logger
from integrations.anthropic_client import JarvisAnthropicClient


@dataclass
class AgentResult:
    agent: str
    task: str
    success: bool
    output: Any
    execution_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    duration_s: float = 0.0
    error: Optional[str] = None
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "agent": self.agent,
            "task": self.task,
            "success": self.success,
            "output": self.output,
            "execution_id": self.execution_id,
            "duration_s": round(self.duration_s, 2),
            "error": self.error,
            "metadata": self.metadata,
        }


class BaseAgent:
    """
    Base class for all Jarvis agents.

    Subclasses must implement:
        async def _execute(self, task: str, **kwargs) -> Any
    """

    name: str = "base"
    description: str = ""
    default_model: str = None

    def __init__(self, vault=None, registry=None):
        self._vault = vault
        self._registry = registry
        self._anthropic = JarvisAnthropicClient(
            model=self.default_model or settings.default_model
        )
        self._improvement_hooks: list = []

    # ── Public run interface ─────────────────────────────────────────────────

    def run(self, task: str, **kwargs) -> AgentResult:
        start = time.monotonic()
        exec_id = str(uuid.uuid4())[:8]
        logger.info("agent_start", agent=self.name, task=task[:80], exec_id=exec_id)
        try:
            output = self._execute(task, **kwargs)
            result = AgentResult(
                agent=self.name,
                task=task,
                success=True,
                output=output,
                execution_id=exec_id,
                duration_s=time.monotonic() - start,
            )
        except Exception as exc:
            logger.error("agent_error", agent=self.name, exc=str(exc))
            result = AgentResult(
                agent=self.name,
                task=task,
                success=False,
                output=None,
                execution_id=exec_id,
                duration_s=time.monotonic() - start,
                error=str(exc),
            )

        self._record_metric(result)
        return result

    # ── To override ─────────────────────────────────────────────────────────

    def _execute(self, task: str, **kwargs) -> Any:
        raise NotImplementedError

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _record_metric(self, result: AgentResult):
        """Write execution metric — consumed by the self-improvement engine."""
        from self_improvement.evaluator import SkillEvaluator
        try:
            evaluator = SkillEvaluator()
            evaluator.record(
                skill=self.name,
                execution_id=result.execution_id,
                success=result.success,
                duration_s=result.duration_s,
                error=result.error,
            )
        except Exception as exc:
            logger.debug("metric_record_failed", exc=str(exc))

    def _simple_complete(self, prompt: str, system: str = "", max_tokens: int = 4096) -> str:
        return self._anthropic.complete(prompt, system=system, max_tokens=max_tokens)
