"""
Thin wrapper around the Anthropic SDK adding retry logic, token counting,
and a unified tool-use loop used by the research harness and agents.
"""
import asyncio
from typing import Any, Callable

import anthropic
from tenacity import retry, stop_after_attempt, wait_exponential

from core.config import settings
from core.logger import logger


class JarvisAnthropicClient:
    def __init__(self, api_key: str = None, model: str = None):
        key = api_key or settings.anthropic_api_key
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set. Run: cp .env.example .env")
        self._client = anthropic.Anthropic(api_key=key)
        self.model = model or settings.default_model

    # ── Simple completion ────────────────────────────────────────────────────

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def complete(
        self,
        prompt: str,
        system: str = "",
        max_tokens: int = 4096,
        model: str = None,
    ) -> str:
        messages = [{"role": "user", "content": prompt}]
        kwargs: dict[str, Any] = {
            "model": model or self.model,
            "max_tokens": max_tokens,
            "messages": messages,
        }
        if system:
            kwargs["system"] = system
        response = self._client.messages.create(**kwargs)
        return response.content[0].text

    # ── Tool-use agentic loop ────────────────────────────────────────────────

    def tool_loop(
        self,
        messages: list[dict],
        tools: list[dict],
        system: str = "",
        max_tokens: int = 8192,
        max_turns: int = 20,
        model: str = None,
        tool_handler: Callable[[str, dict], Any] = None,
    ) -> tuple[str, list[dict]]:
        """
        Run a tool-use agentic loop.

        Returns (final_text, all_messages).
        tool_handler(tool_name, tool_input) -> result (any JSON-serialisable value).
        """
        all_messages = list(messages)
        kwargs: dict[str, Any] = {
            "model": model or self.model,
            "max_tokens": max_tokens,
            "tools": tools,
            "messages": all_messages,
        }
        if system:
            kwargs["system"] = system

        for turn in range(max_turns):
            response = self._client.messages.create(**kwargs)
            logger.debug("tool_loop_turn", turn=turn, stop_reason=response.stop_reason)

            # Collect text and tool-use blocks
            text_blocks = []
            tool_uses = []
            for block in response.content:
                if block.type == "text":
                    text_blocks.append(block.text)
                elif block.type == "tool_use":
                    tool_uses.append(block)

            # Add assistant message to history
            all_messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason == "end_turn" or not tool_uses:
                return "\n".join(text_blocks), all_messages

            # Process all tool calls and build a single tool_result message
            tool_results = []
            for tool_use in tool_uses:
                result = None
                if tool_handler:
                    try:
                        result = tool_handler(tool_use.name, tool_use.input)
                    except Exception as exc:
                        result = {"error": str(exc)}
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use.id,
                        "content": str(result) if result is not None else "done",
                    }
                )

            all_messages.append({"role": "user", "content": tool_results})
            kwargs["messages"] = all_messages

        logger.warning("tool_loop_max_turns_reached", max_turns=max_turns)
        return "", all_messages

    # ── Token counting ───────────────────────────────────────────────────────

    def count_tokens(self, messages: list[dict], system: str = "") -> int:
        kwargs: dict[str, Any] = {"model": self.model, "messages": messages}
        if system:
            kwargs["system"] = system
        result = self._client.messages.count_tokens(**kwargs)
        return result.input_tokens
