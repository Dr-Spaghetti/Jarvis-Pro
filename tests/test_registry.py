"""Tests for client registry — schema v2."""
from pathlib import Path

import pytest

from core.registry import (
    CitationsConfig,
    Client,
    ClientBilling,
    ClientContact,
    ClientRegistry,
    GBPConfig,
    LocalFalconConfig,
    YextConfig,
)


@pytest.fixture
def tmp_registry(tmp_path):
    return ClientRegistry(path=tmp_path / "clients.json")


@pytest.fixture
def sample_client():
    return Client(
        id="test-client",
        name="Test Client",
        industry="home-services",
        business_type="Plumber",
        primary_keyword="plumber dallas",
        city="Dallas",
        state="TX",
        local_falcon=LocalFalconConfig(location_ids=["loc_123"], campaign_ids=["camp_456"]),
        gbp=GBPConfig(place_id="ChIJtest", profile_url="https://g.co/test", primary_category="Plumber"),
        yext=YextConfig(account_id="yext_99"),
        citations=CitationsConfig(target_directories=["yelp", "bbb", "google"], last_audit="2026-01-01"),
        overrides={"citation_audit_skip": ["facebook"]},
        billing=ClientBilling(plan="retainer", monthly_usd=900.0, billing_day=1),
    )


# ── Basic CRUD ────────────────────────────────────────────────────────────────

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


# ── Update ────────────────────────────────────────────────────────────────────

def test_update_top_level(tmp_registry, sample_client):
    tmp_registry.add(sample_client)
    updated = tmp_registry.update("test-client", primary_keyword="emergency plumber dallas")
    assert updated.primary_keyword == "emergency plumber dallas"


def test_update_nested_gbp(tmp_registry, sample_client):
    tmp_registry.add(sample_client)
    updated = tmp_registry.update("test-client", **{"gbp.profile_url": "https://g.co/new"})
    assert updated.gbp.profile_url == "https://g.co/new"


def test_update_nested_local_falcon(tmp_registry, sample_client):
    tmp_registry.add(sample_client)
    updated = tmp_registry.update("test-client", **{"yext.account_id": "yext_new"})
    assert updated.yext.account_id == "yext_new"


def test_update_not_found(tmp_registry):
    with pytest.raises(ValueError, match="not found"):
        tmp_registry.update("nonexistent", city="NY")


# ── Deactivate / remove ───────────────────────────────────────────────────────

def test_deactivate(tmp_registry, sample_client):
    tmp_registry.add(sample_client)
    tmp_registry.deactivate("test-client")
    assert tmp_registry.get("test-client").active is False
    assert tmp_registry.list(active_only=True) == []
    assert len(tmp_registry.list(active_only=False)) == 1


# ── Resolve ───────────────────────────────────────────────────────────────────

def test_resolve_all(tmp_registry):
    for i in range(3):
        tmp_registry.add(Client(id=f"c{i}", name=f"Client {i}"))
    assert len(tmp_registry.resolve("all")) == 3


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


# ── Persistence ───────────────────────────────────────────────────────────────

def test_persistence(tmp_path, sample_client):
    reg_file = tmp_path / "clients.json"
    reg1 = ClientRegistry(path=reg_file)
    reg1.add(sample_client)

    reg2 = ClientRegistry(path=reg_file)
    assert "test-client" in reg2
    loaded = reg2.get("test-client")
    assert loaded.name == "Test Client"
    assert loaded.gbp.place_id == "ChIJtest"
    assert loaded.local_falcon.location_ids == ["loc_123"]
    assert loaded.citations.target_directories == ["yelp", "bbb", "google"]
    assert loaded.overrides == {"citation_audit_skip": ["facebook"]}


# ── Model properties ──────────────────────────────────────────────────────────

def test_has_local_falcon_true(sample_client):
    assert sample_client.has_local_falcon is True


def test_has_local_falcon_false():
    c = Client(id="x", name="X")
    assert c.has_local_falcon is False


def test_primary_location_id(sample_client):
    assert sample_client.local_falcon.primary_location_id == "loc_123"


def test_primary_location_id_empty():
    c = LocalFalconConfig()
    assert c.primary_location_id == ""


def test_location_str(sample_client):
    assert sample_client.location_str == "Dallas, TX"


def test_context_string_includes_overrides(sample_client):
    ctx = sample_client.to_context_string()
    assert "Test Client" in ctx
    assert "plumber dallas" in ctx
    assert "Dallas, TX" in ctx
    assert "citation_audit_skip" in ctx


def test_filter_by_tag(tmp_registry):
    tmp_registry.add(Client(id="c1", name="C1", tags=["legal"]))
    tmp_registry.add(Client(id="c2", name="C2", tags=["home-services"]))
    legal = tmp_registry.list(tags=["legal"])
    assert len(legal) == 1
    assert legal[0].id == "c1"
