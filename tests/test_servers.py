"""Tests for serve.py (OpenAI API) and mcp_http_server.py (MCP HTTP)."""
import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


# ── serve.py ─────────────────────────────────────────────────────────────────

@pytest.fixture
def api_client():
    from serve import app
    return TestClient(app)


def test_list_models(api_client):
    resp = api_client.get("/v1/models")
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data
    model_ids = [m["id"] for m in data["data"]]
    assert "jarvis-citation-audit" in model_ids
    assert "jarvis-falcon-report" in model_ids


def test_health(api_client):
    resp = api_client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_chat_completions_unknown_model(api_client):
    resp = api_client.post("/v1/chat/completions", json={
        "model": "nonexistent-model",
        "messages": [{"role": "user", "content": "hello"}],
    })
    assert resp.status_code == 404


def test_chat_completions_runs_skill(api_client):
    mock_result = MagicMock()
    mock_result.success = True
    mock_result.output = "Citation audit output here"
    mock_result.error = None
    mock_result.vault_path = None
    mock_result.execution_id = "abc123"

    with patch("serve.SKILL_REGISTRY") as mock_registry:
        mock_skill_cls = MagicMock()
        mock_skill_cls.description = "test"
        mock_skill_instance = MagicMock()
        mock_skill_instance.run.return_value = mock_result
        mock_skill_cls.return_value = mock_skill_instance
        mock_registry.__contains__ = lambda self, x: x == "citation-audit"
        mock_registry.keys.return_value = ["citation-audit"]
        mock_registry.__getitem__ = lambda self, x: mock_skill_cls
        mock_registry.items.return_value = [("citation-audit", mock_skill_cls)]

        with patch("serve.registry") as mock_reg:
            mock_client = MagicMock()
            mock_client.name = "Test Client"
            mock_client.id = "test"
            mock_reg.resolve.return_value = [mock_client]

            resp = api_client.post("/v1/chat/completions", json={
                "model": "jarvis-citation-audit",
                "messages": [{"role": "user", "content": "run for all clients"}],
            })
    # Response should be a valid OpenAI-format completion
    assert resp.status_code == 200
    data = resp.json()
    assert data["object"] == "chat.completion"
    assert len(data["choices"]) == 1


def test_extract_client_spec_all():
    from serve import _extract_client_spec
    assert _extract_client_spec("run for all clients") == "all"
    assert _extract_client_spec("no client mention") == "all"


def test_extract_client_spec_list():
    from serve import _extract_client_spec
    result = _extract_client_spec("clients: kaplunmarx, carpet-salem")
    assert result == ["kaplunmarx", "carpet-salem"]


def test_extract_client_spec_single():
    from serve import _extract_client_spec
    result = _extract_client_spec("run for client kaplunmarx")
    assert result == ["kaplunmarx"]


# ── mcp_http_server.py ────────────────────────────────────────────────────────

@pytest.fixture
def mcp_client():
    from mcp_http_server import app
    return TestClient(app)


def test_mcp_health(mcp_client):
    resp = mcp_client.get("/health")
    assert resp.status_code == 200
    assert "tools" in resp.json()


def test_mcp_initialize(mcp_client):
    resp = mcp_client.post("/mcp", json={
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {"protocolVersion": "2024-11-05"},
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["result"]["serverInfo"]["name"] == "jarvis-pro"


def test_mcp_tools_list(mcp_client):
    resp = mcp_client.post("/mcp", json={
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {},
    })
    assert resp.status_code == 200
    tools = resp.json()["result"]["tools"]
    tool_names = [t["name"] for t in tools]
    assert "run_skill" in tool_names
    assert "list_clients" in tool_names
    assert "research" in tool_names


def test_mcp_list_clients(mcp_client):
    resp = mcp_client.post("/mcp", json={
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {"name": "list_clients", "arguments": {}},
    })
    assert resp.status_code == 200
    result = resp.json()["result"]
    content_text = result["content"][0]["text"]
    parsed = json.loads(content_text)
    assert "clients" in parsed


def test_mcp_unknown_method(mcp_client):
    resp = mcp_client.post("/mcp", json={
        "jsonrpc": "2.0",
        "id": 4,
        "method": "does/not/exist",
        "params": {},
    })
    assert resp.status_code == 200
    assert "error" in resp.json()
