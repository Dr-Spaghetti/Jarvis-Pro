from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

from core.config import settings


class ClientContact(BaseModel):
    name: str = ""
    email: str = ""
    phone: str = ""


class ClientBilling(BaseModel):
    plan: str = ""
    monthly_usd: float = 0.0
    billing_day: int = 1


class LocalFalconConfig(BaseModel):
    """Local Falcon location and campaign identifiers."""
    location_ids: list[str] = Field(default_factory=list)
    campaign_ids: list[str] = Field(default_factory=list)
    default_grid: str = "7x7"
    default_radius_miles: int = 5

    @property
    def primary_location_id(self) -> str:
        return self.location_ids[0] if self.location_ids else ""


class GBPConfig(BaseModel):
    """Google Business Profile identifiers and metadata."""
    place_id: str = ""   # ChIJ… format
    cid: str = ""        # numeric CID
    profile_url: str = ""
    primary_category: str = ""


class YextConfig(BaseModel):
    """Yext and supplemental listing management."""
    account_id: str = ""
    listing_count: int = 0
    managed_directly: bool = True
    brightlocal_id: str = ""
    whitespark_id: str = ""
    moz_campaign_id: str = ""


class CitationsConfig(BaseModel):
    """Citation directory targeting and audit history."""
    target_directories: list[str] = Field(default_factory=list)
    last_audit: str = ""


class Client(BaseModel):
    id: str
    name: str
    active: bool = True
    tags: list[str] = Field(default_factory=list)
    industry: str = ""
    business_type: str = ""
    primary_keyword: str = ""
    secondary_keywords: list[str] = Field(default_factory=list)
    city: str = ""
    state: str = ""
    website: str = ""
    billing: ClientBilling = Field(default_factory=ClientBilling)
    local_falcon: LocalFalconConfig = Field(default_factory=LocalFalconConfig)
    gbp: GBPConfig = Field(default_factory=GBPConfig)
    yext: YextConfig = Field(default_factory=YextConfig)
    citations: CitationsConfig = Field(default_factory=CitationsConfig)
    overrides: dict = Field(default_factory=dict)
    contact: ClientContact = Field(default_factory=ClientContact)
    notes: str = ""
    onboarded_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now().isoformat())

    @property
    def has_local_falcon(self) -> bool:
        return bool(self.local_falcon.location_ids)

    @property
    def display_name(self) -> str:
        return self.name

    @property
    def location_str(self) -> str:
        parts = [p for p in [self.city, self.state] if p]
        return ", ".join(parts)

    def to_context_string(self) -> str:
        lines = [
            f"Client: {self.name}",
            f"Industry: {self.industry or self.business_type}",
            f"Location: {self.location_str}",
            f"Website: {self.website}",
            f"Primary Keyword: {self.primary_keyword}",
        ]
        if self.secondary_keywords:
            lines.append(f"Other Keywords: {', '.join(self.secondary_keywords)}")
        if self.gbp.primary_category:
            lines.append(f"GBP Category: {self.gbp.primary_category}")
        if self.citations.target_directories:
            lines.append(f"Key Directories: {', '.join(self.citations.target_directories)}")
        if self.overrides:
            lines.append(f"Overrides: {json.dumps(self.overrides)}")
        if self.tags:
            lines.append(f"Tags: {', '.join(self.tags)}")
        if self.notes:
            lines.append(f"Notes: {self.notes}")
        return "\n".join(lines)


class ClientRegistry:
    """Single source of truth for all client data."""

    def __init__(self, path: Optional[Path] = None):
        self.path = path or settings.clients_file
        self._clients: dict[str, Client] = {}
        self._load()

    def _load(self):
        if not self.path.exists():
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._write_raw({"version": "2.0", "clients": []})
            return
        data = json.loads(self.path.read_text())
        for raw in data.get("clients", []):
            c = Client(**raw)
            self._clients[c.id] = c

    def _write_raw(self, data: dict):
        self.path.write_text(json.dumps(data, indent=2, default=str))

    def save(self):
        data = {
            "version": "2.0",
            "clients": [c.model_dump() for c in self._clients.values()],
        }
        self._write_raw(data)

    # ── Read ────────────────────────────────────────────────────────────────

    def get(self, id_or_name: str) -> Optional[Client]:
        if id_or_name in self._clients:
            return self._clients[id_or_name]
        lower = id_or_name.lower()
        for c in self._clients.values():
            if c.name.lower() == lower or c.id.lower() == lower:
                return c
        return None

    def list(self, active_only: bool = True, tags: Optional[list[str]] = None) -> list[Client]:
        clients = list(self._clients.values())
        if active_only:
            clients = [c for c in clients if c.active]
        if tags:
            clients = [c for c in clients if any(t in c.tags for t in tags)]
        return sorted(clients, key=lambda c: c.name)

    def resolve(self, spec: str | list[str]) -> list[Client]:
        """Resolve 'all', a single ID, or a list of IDs to Client objects."""
        if spec == "all":
            return self.list(active_only=True)
        if isinstance(spec, str):
            spec = [spec]
        result = []
        for s in spec:
            c = self.get(s)
            if c:
                result.append(c)
        return result

    # ── Write ───────────────────────────────────────────────────────────────

    def add(self, client: Client) -> Client:
        if client.id in self._clients:
            raise ValueError(f"Client '{client.id}' already exists")
        self._clients[client.id] = client
        self.save()
        return client

    def update(self, id_or_name: str, **updates) -> Client:
        client = self.get(id_or_name)
        if not client:
            raise ValueError(f"Client '{id_or_name}' not found")
        data = client.model_dump()
        for key, value in updates.items():
            if "." in key:
                top, sub = key.split(".", 1)
                if top in data and isinstance(data[top], dict):
                    data[top][sub] = value
                else:
                    data[key] = value
            else:
                data[key] = value
        data["updated_at"] = datetime.now().isoformat()
        self._clients[client.id] = Client(**data)
        self.save()
        return self._clients[client.id]

    def deactivate(self, id_or_name: str) -> Client:
        return self.update(id_or_name, active=False)

    def remove(self, id_or_name: str):
        client = self.get(id_or_name)
        if not client:
            raise ValueError(f"Client '{id_or_name}' not found")
        del self._clients[client.id]
        self.save()

    def __len__(self) -> int:
        return len(self._clients)

    def __contains__(self, id_or_name: str) -> bool:
        return self.get(id_or_name) is not None
