"""
Simple file-backed research cache with TTL.
Keyed by SHA256(topic.lower()) to avoid re-running identical queries within the TTL window.
"""
import hashlib
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from core.config import settings


class ResearchMemory:
    def __init__(self, cache_file: Optional[Path] = None):
        self._file = cache_file or settings.research_cache_file
        self._ttl = timedelta(days=settings.research_cache_ttl_days)
        self._data: dict[str, dict] = {}
        self._load()

    def _load(self):
        if self._file.exists():
            try:
                self._data = json.loads(self._file.read_text())
            except Exception:
                self._data = {}

    def _save(self):
        self._file.parent.mkdir(parents=True, exist_ok=True)
        self._file.write_text(json.dumps(self._data, indent=2, default=str))

    def _key(self, topic: str) -> str:
        return hashlib.sha256(topic.lower().strip().encode()).hexdigest()[:16]

    def get(self, topic: str) -> Optional[dict]:
        k = self._key(topic)
        entry = self._data.get(k)
        if not entry:
            return None
        stored_at = datetime.fromisoformat(entry["stored_at"])
        if datetime.now() - stored_at > self._ttl:
            del self._data[k]
            self._save()
            return None
        return entry["result"]

    def store(self, topic: str, result: dict):
        k = self._key(topic)
        self._data[k] = {
            "topic": topic,
            "stored_at": datetime.now().isoformat(),
            "result": result,
        }
        self._save()
        self._evict_expired()

    def _evict_expired(self):
        cutoff = datetime.now() - self._ttl
        stale = [
            k for k, v in self._data.items()
            if datetime.fromisoformat(v["stored_at"]) < cutoff
        ]
        for k in stale:
            del self._data[k]
        if stale:
            self._save()

    def clear(self):
        self._data = {}
        self._save()
