"""Tests for client registry."""
import json
import tempfile
from pathlib import Path

import pytest

from core.registry import Client, ClientRegistry


@pytest.fixture
def tmp_registry(tmp_path):
    reg_file = tmp_path / "clients.json"
    return ClientRegistry(path=reg_file)


@pytest.fixture
def sample_client():
    return Client(
        id="test-client",
        name="Test Client",
        business_type="Plumber",
        primary_keyword="plumber dallas",
        city="Dallas",
        state="TX",
    )


def test_empty_registry(tmp_registry):
    assert len(tmp_registry) == 0
    assert tmp_registry.list() == []


def test_add_client(tmp_registry, sample_client):
    tmp_registry.add(sample_client)
    assert len(tmp_registry) == 1
    assert "test-client" in tmp_registry


def test_add_duplicate_raises(tmp_registry, sample_client):
    tmp_registry.add(sample_client)
    with pytest.raises(ValueError, match="already exists"):
        tmp_registry.add(sample_client)


def test_get_by_id(tmp_registry, sample_client):
    tmp_registry.add(sample_client)
    found = tmp_registry.get("test-client")
    assert found is not None
    assert found.name == "Test Client"


def test_get_by_name(tmp_registry, sample_client):
    tmp_registry.add(sample_client)
    found = tmp_registry.get("Test Client")
    assert found is not None
    assert found.id == "test-client"


def test_get_not_found(tmp_registry):
    assert tmp_registry.get("nonexistent") is None


def test_update_top_level(tmp_registry, sample_client):
    tmp_registry.add(sample_client)
    updated = tmp_registry.update("test-client", primary_keyword="emergency plumber dallas")
    assert updated.primary_keyword == "emergency plumber dallas"


def test_update_nested_integration(tmp_registry, sample_client):
    tmp_registry.add(sample_client)
    updated = tmp_registry.update("test-client", **{"integrations.gbp_url": "https://g.co/test"})
    assert updated.integrations.gbp_url == "https://g.co/test"


def test_update_not_found(tmp_registry):
    with pytest.raises(ValueError, match="not found"):
        tmp_registry.update("nonexistent", city="NY")


def test_deactivate(tmp_registry, sample_client):
    tmp_registry.add(sample_client)
    tmp_registry.deactivate("test-client")
    assert tmp_registry.get("test-client").active is False
    assert tmp_registry.list(active_only=True) == []
    assert len(tmp_registry.list(active_only=False)) == 1


def test_resolve_all(tmp_registry):
    for i in range(3):
        tmp_registry.add(Client(id=f"c{i}", name=f"Client {i}"))
    result = tmp_registry.resolve("all")
    assert len(result) == 3


def test_resolve_single(tmp_registry, sample_client):
    tmp_registry.add(sample_client)
    result = tmp_registry.resolve("test-client")
    assert len(result) == 1
    assert result[0].id == "test-client"


def test_resolve_list(tmp_registry):
    for i in range(3):
        tmp_registry.add(Client(id=f"c{i}", name=f"Client {i}"))
    result = tmp_registry.resolve(["c0", "c2"])
    assert len(result) == 2


def test_persistence(tmp_path, sample_client):
    reg_file = tmp_path / "clients.json"
    reg1 = ClientRegistry(path=reg_file)
    reg1.add(sample_client)

    # Load fresh instance from same file
    reg2 = ClientRegistry(path=reg_file)
    assert "test-client" in reg2
    assert reg2.get("test-client").name == "Test Client"


def test_location_str(sample_client):
    assert sample_client.location_str == "Dallas, TX"


def test_context_string(sample_client):
    ctx = sample_client.to_context_string()
    assert "Test Client" in ctx
    assert "plumber dallas" in ctx
    assert "Dallas, TX" in ctx


def test_filter_by_tag(tmp_registry):
    c1 = Client(id="c1", name="C1", tags=["legal"])
    c2 = Client(id="c2", name="C2", tags=["home-services"])
    tmp_registry.add(c1)
    tmp_registry.add(c2)
    legal = tmp_registry.list(tags=["legal"])
    assert len(legal) == 1
    assert legal[0].id == "c1"
