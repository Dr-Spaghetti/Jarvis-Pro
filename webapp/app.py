"""
Jarvis-Pro Web UI — FastAPI server powering the interactive dashboard.

Serves the single-page HTML interface and exposes JSON API endpoints
consumed by the frontend.

Run:
    python webapp/app.py          # port 7860
    PORT=8080 python webapp/app.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Make the project root importable regardless of cwd
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

from typing import Optional

import uvicorn
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from core.config import settings
from core.logger import logger
from core.registry import ClientRegistry
from skills import SKILL_REGISTRY

app = FastAPI(title="Jarvis-Pro UI", docs_url=None, redoc_url=None)

TEMPLATE = (Path(__file__).parent / "templates" / "index.html").read_text()

# ── HTML ─────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    return HTMLResponse(TEMPLATE)

# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    reg = ClientRegistry()
    return {
        "status": "ok",
        "clients": len(reg.list(active_only=True)),
        "skills": len(SKILL_REGISTRY),
        "anthropic": settings.has_anthropic,
        "vault": settings.has_vault,
    }

# ── Clients ───────────────────────────────────────────────────────────────────

@app.get("/api/clients")
async def list_clients():
    reg = ClientRegistry()
    result = []
    for c in reg.list(active_only=True):
        result.append({
            "id": c.id,
            "name": c.name,
            "industry": c.industry,
            "business_type": c.business_type,
            "city": c.city,
            "state": c.state,
            "website": c.website,
            "primary_keyword": c.primary_keyword,
            "tags": c.tags,
            "notes": c.notes,
            "gbp": c.gbp.model_dump(),
            "billing": c.billing.model_dump(),
            "local_falcon": c.local_falcon.model_dump(),
        })
    return result

@app.get("/api/clients/{client_id}")
async def get_client(client_id: str):
    reg = ClientRegistry()
    c = reg.get(client_id)
    if not c:
        return {"error": f"Client '{client_id}' not found"}
    return {
        "id": c.id,
        "name": c.name,
        "context": c.to_context_string(),
        "gbp": c.gbp.model_dump(),
        "billing": c.billing.model_dump(),
        "local_falcon": c.local_falcon.model_dump(),
        "yext": c.yext.model_dump(),
        "citations": c.citations.model_dump(),
        "overrides": c.overrides,
    }

# ── Skills ────────────────────────────────────────────────────────────────────

@app.get("/api/skills")
async def list_skills():
    return [
        {"name": name, "description": cls.description}
        for name, cls in SKILL_REGISTRY.items()
    ]

class RunSkillRequest(BaseModel):
    skill: str
    clients: str = "all"      # "all" or comma-separated IDs
    note: str = ""

@app.post("/api/run-skill")
async def run_skill(req: RunSkillRequest):
    if req.skill not in SKILL_REGISTRY:
        return {"error": f"Unknown skill: {req.skill}"}
    if not settings.has_anthropic:
        return {"error": "ANTHROPIC_API_KEY not configured."}

    reg = ClientRegistry()
    client_ids = "all" if req.clients == "all" else [c.strip() for c in req.clients.split(",")]
    client_list = reg.resolve(client_ids)
    if not client_list:
        return {"error": "No matching clients found."}

    vault = _get_vault()
    skill_cls = SKILL_REGISTRY[req.skill]
    skill = skill_cls(vault=vault)

    results = []
    for client in client_list:
        logger.info("webapp_skill_run", skill=req.skill, client=client.id)
        r = skill.run(client)
        results.append({
            "client_id": client.id,
            "client_name": client.name,
            "success": r.success,
            "output": r.output,
            "error": r.error,
            "duration_s": round(r.duration_s, 2),
            "execution_id": r.execution_id,
            "vault_path": r.vault_path,
        })

    return {"results": results, "skill": req.skill}

# ── Research ──────────────────────────────────────────────────────────────────

class ResearchRequest(BaseModel):
    topic: str
    depth: int = 2
    client_id: Optional[str] = None

@app.post("/api/research")
async def run_research(req: ResearchRequest):
    if not settings.has_anthropic:
        return {"error": "ANTHROPIC_API_KEY not configured."}
    if not req.topic.strip():
        return {"error": "Topic is required."}

    settings.ensure_jarvis_dirs()
    from research.harness import ResearchHarness

    reg = ClientRegistry()
    vault = _get_vault()
    harness = ResearchHarness(vault=vault, registry=reg)

    try:
        result = harness.research(
            req.topic,
            client_id=req.client_id,
            depth=req.depth,
            save_to_vault=vault is not None,
            use_cache=True,
        )
        return {
            "summary": result.summary,
            "sources": len(result.sources),
            "cached": result.cached,
            "vault_path": result.vault_path,
        }
    except Exception as exc:
        logger.error("webapp_research_error", exc=str(exc))
        return {"error": str(exc)}

# ── Metrics ───────────────────────────────────────────────────────────────────

@app.get("/api/metrics")
async def get_metrics():
    settings.ensure_jarvis_dirs()
    from self_improvement.evaluator import SkillEvaluator

    ev = SkillEvaluator()
    all_skills = list(SKILL_REGISTRY.keys())
    rows = []
    for skill_name in all_skills:
        m = ev.get_metrics(skill_name)
        rows.append({
            "skill": skill_name,
            "total_executions": m.total_executions,
            "success_rate": round(m.success_rate * 100, 1) if m.success_rate is not None else None,
            "avg_duration_s": round(m.avg_duration_s, 2) if m.avg_duration_s else None,
            "avg_user_rating": m.avg_user_rating,
            "status": "GREEN" if m.total_executions == 0 else (
                "GREEN" if (m.success_rate or 0) >= 0.80 else "RED"
            ),
        })
    return {"skills": rows}

# ── Feedback ──────────────────────────────────────────────────────────────────

class FeedbackRequest(BaseModel):
    execution_id: str
    rating: int
    notes: str = ""

@app.post("/api/feedback")
async def submit_feedback(req: FeedbackRequest):
    if not 1 <= req.rating <= 5:
        return {"error": "Rating must be 1–5."}
    settings.ensure_jarvis_dirs()
    from self_improvement.feedback_loop import FeedbackLoop

    ok = FeedbackLoop().quick_feedback(req.execution_id, req.rating, req.notes)
    return {"ok": ok}

# ── Voices ────────────────────────────────────────────────────────────────────

@app.get("/api/voices")
async def get_voices():
    from integrations.tts import list_voices, SKILL_VOICE_MAP, DEFAULT_VOICE
    return {
        "voices": [
            {
                "alias": v.alias,
                "gender": v.gender,
                "style": v.style,
                "best_for": v.best_for,
                "is_default": v.alias == DEFAULT_VOICE,
            }
            for v in list_voices()
        ],
        "skill_defaults": SKILL_VOICE_MAP,
    }

# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_vault():
    if not settings.has_vault:
        return None
    try:
        from integrations.obsidian import ObsidianVault
        return ObsidianVault()
    except Exception:
        return None

# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", 7860))
    print(f"\n  Jarvis-Pro Web UI → http://0.0.0.0:{port}\n")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
