"""
SkillBase — base class for all task-based skills.

Skills are the unit of work in Jarvis. A skill:
- Accepts a Client object and optional params
- Runs a focused task against that client
- Returns a SkillResult with output and metadata
- Is automatically measured by the self-improvement system

To add a new skill:
1. Create skills/your_skill.py subclassing SkillBase
2. Implement run(client, **params) -> SkillResult
3. Add to SKILL_REGISTRY in skills/__init__.py
"""
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from core.config import settings
from core.logger import logger
from core.registry import Client
from integrations.anthropic_client import JarvisAnthropicClient


@dataclass
class SkillResult:
    skill: str
    client_id: str
    client_name: str
    success: bool
    output: Any
    execution_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    duration_s: float = 0.0
    vault_path: Optional[str] = None
    error: Optional[str] = None

    def __str__(self) -> str:
        status = "OK" if self.success else "FAIL"
        return f"[{status}] {self.skill} / {self.client_name} ({self.duration_s:.1f}s)"


class SkillBase:
    name: str = "base"
    description: str = ""

    def __init__(self, vault=None):
        self._vault = vault
        self._anthropic: "JarvisAnthropicClient | None" = None  # lazy-initialized

    def run(self, client: Client, **params) -> SkillResult:
        start = time.monotonic()
        exec_id = str(uuid.uuid4())[:8]
        logger.info("skill_start", skill=self.name, client=client.id, exec_id=exec_id)
        try:
            output = self._run(client, **params)
            result = SkillResult(
                skill=self.name,
                client_id=client.id,
                client_name=client.name,
                success=True,
                output=output,
                execution_id=exec_id,
                duration_s=time.monotonic() - start,
            )
            # Optionally save to vault
            if self._vault and params.get("save_vault", False):
                try:
                    result.vault_path = str(self._save_to_vault(client, result))
                except Exception as ve:
                    logger.warning("skill_vault_save_failed", exc=str(ve))
        except Exception as exc:
            logger.error("skill_error", skill=self.name, client=client.id, exc=str(exc))
            result = SkillResult(
                skill=self.name,
                client_id=client.id,
                client_name=client.name,
                success=False,
                output=None,
                execution_id=exec_id,
                duration_s=time.monotonic() - start,
                error=str(exc),
            )
        self._record(result)
        return result

    @property
    def anthropic(self) -> "JarvisAnthropicClient":
        if self._anthropic is None:
            self._anthropic = JarvisAnthropicClient(model=settings.default_model)
        return self._anthropic

    def _run(self, client: Client, **params) -> Any:
        raise NotImplementedError

    def _save_to_vault(self, client: Client, result: SkillResult):
        """Override to customize vault write behavior."""
        if self._vault and result.output:
            rel = f"1-Projects/{client.id}/{self.name}-{result.execution_id}.md"
            return self._vault.write_note(rel, str(result.output))

    def _record(self, result: SkillResult):
        from self_improvement.evaluator import SkillEvaluator
        try:
            SkillEvaluator().record(
                skill=self.name,
                execution_id=result.execution_id,
                success=result.success,
                duration_s=result.duration_s,
                error=result.error,
                client_id=result.client_id,
            )
        except Exception:
            pass
