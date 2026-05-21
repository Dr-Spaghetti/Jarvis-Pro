"""
Research source handlers.

Each source exposes a search(query) -> list[dict] interface.
Results are dicts with at minimum: title, snippet, url.
"""
from typing import Optional

import httpx

from core.config import settings
from core.logger import logger


class BraveSearchSource:
    """Brave Search API source."""

    API_URL = "https://api.search.brave.com/res/v1/web/search"

    def __init__(self, api_key: str = None):
        self._key = api_key or settings.brave_search_api_key
        if not self._key:
            logger.warning("brave_search_no_key", msg="BRAVE_SEARCH_API_KEY not set; web search disabled")

    def search(self, query: str, num_results: int = 5) -> list[dict]:
        if not self._key:
            return [{"title": "Web search unavailable", "snippet": "No BRAVE_SEARCH_API_KEY configured.", "url": ""}]
        headers = {"Accept": "application/json", "X-Subscription-Token": self._key}
        params = {"q": query, "count": num_results}
        resp = httpx.get(self.API_URL, headers=headers, params=params, timeout=15)
        if resp.status_code != 200:
            logger.error("brave_search_error", status=resp.status_code)
            return []
        data = resp.json()
        results = []
        for item in data.get("web", {}).get("results", [])[:num_results]:
            results.append({
                "title": item.get("title", ""),
                "snippet": item.get("description", ""),
                "url": item.get("url", ""),
            })
        return results


class DuckDuckGoSource:
    """DuckDuckGo instant-answer API (no key required, limited)."""

    API_URL = "https://api.duckduckgo.com/"

    def search(self, query: str, num_results: int = 5) -> list[dict]:
        try:
            params = {"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"}
            resp = httpx.get(self.API_URL, params=params, timeout=10)
            data = resp.json()
            results = []
            if data.get("AbstractText"):
                results.append({
                    "title": data.get("Heading", query),
                    "snippet": data["AbstractText"],
                    "url": data.get("AbstractURL", ""),
                })
            for topic in data.get("RelatedTopics", [])[:num_results - len(results)]:
                if isinstance(topic, dict) and "Text" in topic:
                    results.append({
                        "title": topic.get("Text", "")[:80],
                        "snippet": topic.get("Text", ""),
                        "url": topic.get("FirstURL", ""),
                    })
            return results[:num_results]
        except Exception as exc:
            logger.error("ddg_search_error", exc=str(exc))
            return []


def get_web_source() -> "BraveSearchSource | DuckDuckGoSource":
    """Return the best available web search source."""
    if settings.has_brave_search:
        return BraveSearchSource()
    return DuckDuckGoSource()
