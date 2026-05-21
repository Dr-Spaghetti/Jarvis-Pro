"""
Jarvis-Pro OpenAI-Compatible API Server

Exposes every Jarvis skill as a "model" in an OpenAI /v1/chat/completions API.
LibreChat connects via the custom endpoint config in docker/librechat.yaml.

Usage:
    python serve.py          # listens on 0.0.0.0:8000

LibreChat config (librechat.yaml):
    custom:
      - name: "Jarvis Skills"
        apiKey: "jarvis"
        baseURL: "http://host.docker.internal:8000/v1"
        models:
          default: [jarvis-citation-audit, jarvis-falcon-report, ...]
          fetch: true

Protocol:
    POST /v1/chat/completions
    GET  /v1/models

Message parsing:
    The last user message is parsed for client targeting:
      "Run for clients: kaplunmarx, carpet-salem"  → those two clients
      "Run for all clients"                         → all active clients
      (anything else)                               → all active clients
"""
import json
import re
import time
import uuid
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from core.config import settings
from core.registry import ClientRegistry
from skills import SKILL_REGISTRY

settings.ensure_jarvis_dirs()

app = FastAPI(title="Jarvis-Pro", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

registry = ClientRegistry()


# ── Request / response models ────────────────────────────────────────────────


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    stream: bool = False
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None


# ── Helpers ──────────────────────────────────────────────────────────────────


def _skill_name(model: str) -> str:
    """jarvis-citation-audit  →  citation-audit"""
    return model.removeprefix("jarvis-")


def _extract_client_spec(text: str) -> str | list[str]:
    """
    Parse client targeting from a user message.

    Patterns recognised:
        "clients: id1, id2"
        "for client kaplunmarx"
        "all clients" / "all"
    """
    # Explicit list: "clients: a, b"
    m = re.search(r"clients?\s*[:=]\s*([^\n.]+)", text, re.IGNORECASE)
    if m:
        raw = m.group(1).strip()
        if raw.lower() == "all":
            return "all"
        return [c.strip() for c in raw.split(",") if c.strip()]

    # Single client mention: "for client kaplunmarx"
    m = re.search(r"for\s+client\s+([a-z0-9-]+)", text, re.IGNORECASE)
    if m:
        return [m.group(1).strip()]

    return "all"


def _run_skill(skill_name: str, user_message: str) -> str:
    if skill_name not in SKILL_REGISTRY:
        return f"❌ Unknown skill `{skill_name}`. Available: {list(SKILL_REGISTRY)}"

    client_spec = _extract_client_spec(user_message)
    clients = registry.resolve(client_spec)
    if not clients:
        return f"❌ No clients matched spec `{client_spec}`. Run `jarvis client list` to see options."

    skill_cls = SKILL_REGISTRY[skill_name]
    vault = None
    try:
        from core.config import settings as cfg
        if cfg.has_vault:
            from integrations.obsidian import ObsidianVault
            vault = ObsidianVault()
    except Exception:
        pass

    skill = skill_cls(vault=vault)
    sections = []
    for client in clients:
        r = skill.run(client)
        icon = "✅" if r.success else "❌"
        header = f"## {icon} {client.name}"
        body = r.output if r.success else f"Error: {r.error}"
        sections.append(f"{header}\n\n{body}")
        if r.vault_path:
            sections[-1] += f"\n\n*Saved to vault: `{r.vault_path}`*"

    return "\n\n---\n\n".join(sections)


# ── Endpoints ─────────────────────────────────────────────────────────────────


@app.get("/v1/models")
def list_models():
    return {
        "object": "list",
        "data": [
            {
                "id": f"jarvis-{name}",
                "object": "model",
                "created": 1748000000,
                "owned_by": "jarvis",
                "description": cls.description,
            }
            for name, cls in SKILL_REGISTRY.items()
        ],
    }


@app.post("/v1/chat/completions")
def chat_completions(req: ChatRequest):
    skill_name = _skill_name(req.model)
    if skill_name not in SKILL_REGISTRY:
        raise HTTPException(
            status_code=404,
            detail=f"Model '{req.model}' not found. Available models: "
            + str([f"jarvis-{s}" for s in SKILL_REGISTRY]),
        )

    # Get last user message
    user_msg = next(
        (m.content for m in reversed(req.messages) if m.role == "user"), ""
    )

    content = _run_skill(skill_name, user_msg)

    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": req.model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


@app.get("/health")
def health():
    return {"status": "ok", "skills": list(SKILL_REGISTRY), "clients": len(registry)}


if __name__ == "__main__":
    print(f"Jarvis-Pro API server starting on http://0.0.0.0:8000")
    print(f"Skills available: {list(SKILL_REGISTRY)}")
    print(f"Clients loaded: {len(registry.list())}")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
