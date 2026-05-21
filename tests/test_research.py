"""Tests for the research memory and source modules."""
import json
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from research.memory import ResearchMemory


@pytest.fixture
def memory(tmp_path):
    return ResearchMemory(cache_file=tmp_path / "cache.json")


def test_store_and_retrieve(memory):
    memory.store("test topic", {"summary": "test summary", "sources": []})
    result = memory.get("test topic")
    assert result is not None
    assert result["summary"] == "test summary"


def test_case_insensitive(memory):
    memory.store("Test Topic", {"summary": "hello"})
    assert memory.get("test topic") is not None
    assert memory.get("TEST TOPIC") is not None


def test_miss_returns_none(memory):
    assert memory.get("unknown topic") is None


def test_ttl_expiry(tmp_path):
    mem = ResearchMemory(cache_file=tmp_path / "cache.json")
    mem._ttl = __import__("datetime").timedelta(seconds=0)  # 0 TTL = always expired
    mem.store("topic", {"summary": "old"})
    assert mem.get("topic") is None


def test_clear(memory):
    memory.store("t1", {"summary": "a"})
    memory.store("t2", {"summary": "b"})
    memory.clear()
    assert memory.get("t1") is None
    assert memory.get("t2") is None


def test_persistence(tmp_path):
    cache_file = tmp_path / "cache.json"
    m1 = ResearchMemory(cache_file=cache_file)
    m1.store("persistent topic", {"summary": "persisted"})

    m2 = ResearchMemory(cache_file=cache_file)
    result = m2.get("persistent topic")
    assert result is not None
    assert result["summary"] == "persisted"


def test_overwrite(memory):
    memory.store("topic", {"summary": "v1"})
    memory.store("topic", {"summary": "v2"})
    assert memory.get("topic")["summary"] == "v2"
