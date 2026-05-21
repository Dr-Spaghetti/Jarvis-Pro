"""
Local Falcon API client (thin wrapper around their REST API).
Docs: https://localfalcon.com/api/docs

All methods return raw dicts — callers handle Pydantic parsing if needed.
"""
from typing import Optional

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from core.config import settings
from core.logger import logger

BASE_URL = "https://api.localfalcon.com/v1"


class LocalFalconError(Exception):
    pass


class LocalFalconClient:
    def __init__(self, api_key: str = None):
        key = api_key or settings.local_falcon_api_key
        if not key:
            raise RuntimeError(
                "LOCAL_FALCON_API_KEY is not set. Add it to .env to enable Local Falcon features."
            )
        self._headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}
        self._http = httpx.Client(base_url=BASE_URL, headers=self._headers, timeout=30)

    def _get(self, path: str, params: dict = None) -> dict:
        resp = self._http.get(path, params=params or {})
        if resp.status_code != 200:
            raise LocalFalconError(f"Local Falcon API error {resp.status_code}: {resp.text}")
        return resp.json()

    # ── Scan reports ────────────────────────────────────────────────────────

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def list_scan_reports(self, location_id: str, limit: int = 10) -> list[dict]:
        data = self._get(f"/locations/{location_id}/scans", {"limit": limit})
        return data.get("scans", [])

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def get_scan(self, scan_id: str) -> dict:
        return self._get(f"/scans/{scan_id}")

    # ── Location reports ────────────────────────────────────────────────────

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def get_location_report(self, location_id: str) -> dict:
        return self._get(f"/locations/{location_id}/report")

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def get_keyword_report(self, location_id: str, keyword: str) -> dict:
        return self._get(
            f"/locations/{location_id}/keywords/report",
            {"keyword": keyword},
        )

    # ── Trend reports ───────────────────────────────────────────────────────

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def get_trend_report(self, location_id: str, days: int = 30) -> dict:
        return self._get(f"/locations/{location_id}/trend", {"days": days})

    # ── Convenience ─────────────────────────────────────────────────────────

    def summarize_latest_scan(self, location_id: str) -> str:
        """Return a human-readable one-paragraph summary of the latest scan."""
        scans = self.list_scan_reports(location_id, limit=1)
        if not scans:
            return "No scan reports found for this location."
        scan = self.get_scan(scans[0]["id"])
        avg_rank = scan.get("average_rank", "N/A")
        top3 = scan.get("top_3_percentage", "N/A")
        top10 = scan.get("top_10_percentage", "N/A")
        keyword = scan.get("keyword", "unknown keyword")
        date = scan.get("created_at", "")[:10]
        return (
            f"Latest scan ({date}) for '{keyword}': avg rank {avg_rank}, "
            f"{top3}% in top-3, {top10}% in top-10."
        )
