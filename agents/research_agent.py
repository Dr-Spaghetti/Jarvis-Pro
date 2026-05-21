"""
ResearchAgent — wraps the ResearchHarness with agent lifecycle management.
"""
from typing import Optional

from agents.base_agent import BaseAgent
from core.config import settings
from research.harness import ResearchHarness, ResearchResult


class ResearchAgent(BaseAgent):
    name = "research"
    description = "Multi-source research agent. Queries web + vault + client context, synthesizes findings into structured Markdown notes."
    default_model = None  # inherits settings.research_model via harness

    def __init__(self, vault=None, registry=None):
        super().__init__(vault=vault, registry=registry)
        self._harness = ResearchHarness(vault=vault, registry=registry)

    def _execute(self, task: str, **kwargs) -> dict:
        depth = kwargs.get("depth", settings.max_research_depth)
        client_id = kwargs.get("client_id")
        save = kwargs.get("save_to_vault", True)
        use_cache = kwargs.get("use_cache", True)

        result: ResearchResult = self._harness.research(
            topic=task,
            depth=depth,
            client_id=client_id,
            save_to_vault=save,
            use_cache=use_cache,
        )
        return result.to_dict()

    def research(
        self,
        topic: str,
        client_id: Optional[str] = None,
        depth: int = None,
        save_to_vault: bool = True,
    ) -> ResearchResult:
        """Convenience method that returns a typed ResearchResult."""
        from research.harness import ResearchHarness
        harness = ResearchHarness(vault=self._vault, registry=self._registry)
        return harness.research(
            topic,
            client_id=client_id,
            depth=depth,
            save_to_vault=save_to_vault,
        )
