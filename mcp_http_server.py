"""
Jarvis-Pro MCP Streamable HTTP Server

Exposes Jarvis tools over the MCP Streamable HTTP transport so LibreChat
agents (and any other MCP-capable host) can call them without needing a
local Python install.

Usage:
    python mcp_http_server.py     # listens on 0.0.0.0:8765

LibreChat config (docker/librechat.yaml):
    mcpServers:
      jarvis-tools:
        type: streamable-http
        url: "http://host.docker.internal:8765/mcp"

Tools exposed:
    list_clients      — registry query
    get_client        — full client details
    run_skill         — execute any registered skill
    research          — research harness
    skill_metrics     — self-improvement evaluator stats
    list_skills       — discover available skills

Protocol: JSON-RPC 2.0 over HTTP POST /mcp
"""
import json
import uuid

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.config import settings
from core.registry import ClientRegistry
from skills import SKILL_REGISTRY

settings.ensure_jarvis_dirs()

app = FastAPI(title="Jarvis-Pro MCP Server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

registry = ClientRegistry()

# ── Tool definitions ──────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "list_clients",
        "description": "List all clients in the Jarvis registry.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "active_only": {"type": "boolean", "default": True}
            },
        },
    },
    {
        "name": "get_client",
        "description": "Get full details for a specific client by ID or name.",
        "inputSchema": {
            "type": "object",
            "properties": {"client_id": {"type": "string"}},
            "required": ["client_id"],
        },
    },
    {
        "name": "list_skills",
        "description": "List all available Jarvis skills with descriptions.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "run_skill",
        "description": "Run a Jarvis skill for one or more clients. Returns markdown output.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "skill": {
                    "type": "string",
                    "description": "Skill name",
                    "enum": list(SKILL_REGISTRY.keys()),
                },
                "clients": {
                    "type": "string",
                    "description": "'all' or comma-separated client IDs",
                    "default": "all",
                },
                "save_vault": {
                    "type": "boolean",
                    "description": "Write output to Obsidian vault",
                    "default": False,
                },
            },
            "required": ["skill"],
        },
    },
    {
        "name": "research",
        "description": "Run the Jarvis multi-source research harness on a topic.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "topic": {"type": "string"},
                "client_id": {"type": "string", "description": "Optional — adds client context"},
                "depth": {"type": "integer", "default": 2, "minimum": 1, "maximum": 5},
                "save_vault": {"type": "boolean", "default": True},
            },
            "required": ["topic"],
        },
    },
    {
        "name": "skill_metrics",
        "description": "Get performance metrics for a skill (success rate, avg duration, needs_improvement).",
        "inputSchema": {
            "type": "object",
            "properties": {"skill": {"type": "string"}},
            "required": ["skill"],
        },
    },
]


# ── Tool handlers ─────────────────────────────────────────────────────────────


def _handle(tool_name: str, args: dict) -> dict:
    if tool_name == "list_clients":
        clients = registry.list(active_only=args.get("active_only", True))
        return {
            "clients": [
                {
                    "id": c.id,
                    "name": c.name,
                    "industry": c.industry or c.business_type,
                    "location": c.location_str,
                    "primary_keyword": c.primary_keyword,
                }
                for c in clients
            ]
        }

    if tool_name == "get_client":
        c = registry.get(args["client_id"])
        if not c:
            return {"error": f"Client not found: {args['client_id']}"}
        return c.model_dump()

    if tool_name == "list_skills":
        return {
            "skills": [
                {"name": k, "description": v.description}
                for k, v in SKILL_REGISTRY.items()
            ]
        }

    if tool_name == "run_skill":
        skill_name = args["skill"]
        if skill_name not in SKILL_REGISTRY:
            return {"error": f"Unknown skill: {skill_name}"}
        raw_spec = args.get("clients", "all")
        spec = (
            "all"
            if raw_spec == "all"
            else [s.strip() for s in raw_spec.split(",")]
        )
        clients = registry.resolve(spec)
        if not clients:
            return {"error": f"No clients matched: {raw_spec}"}
        skill = SKILL_REGISTRY[skill_name]()
        results = []
        for client in clients:
            r = skill.run(client, save_vault=args.get("save_vault", False))
            results.append(
                {
                    "client": client.name,
                    "success": r.success,
                    "output": r.output if r.success else None,
                    "error": r.error,
                    "execution_id": r.execution_id,
                }
            )
        return {"results": results}

    if tool_name == "research":
        from research.harness import ResearchHarness
        harness = ResearchHarness(registry=registry)
        result = harness.research(
            topic=args["topic"],
            client_id=args.get("client_id"),
            depth=args.get("depth", 2),
            save_to_vault=args.get("save_vault", True),
        )
        return result.to_dict()

    if tool_name == "skill_metrics":
        from self_improvement.evaluator import SkillEvaluator
        m = SkillEvaluator().get_metrics(args["skill"])
        return {
            "skill": m.skill,
            "total_executions": m.total_executions,
            "success_rate": m.success_rate,
            "avg_duration_s": m.avg_duration_s,
            "avg_user_rating": m.avg_user_rating,
            "needs_improvement": m.needs_improvement,
        }

    return {"error": f"Unknown tool: {tool_name}"}


# ── MCP JSON-RPC endpoint ─────────────────────────────────────────────────────


@app.post("/mcp")
async def mcp_endpoint(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
        )

    method = body.get("method", "")
    msg_id = body.get("id")

    if method == "initialize":
        result = {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "jarvis-pro", "version": "0.1.0"},
        }
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        params = body.get("params", {})
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})
        try:
            content = _handle(tool_name, tool_args)
            return JSONResponse({
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(content, indent=2)}]
                },
            })
        except Exception as exc:
            return JSONResponse({
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "content": [{"type": "text", "text": f"Error: {exc}"}],
                    "isError": True,
                },
            })
    else:
        return JSONResponse({
            "jsonrpc": "2.0",
            "id": msg_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        })

    return JSONResponse({"jsonrpc": "2.0", "id": msg_id, "result": result})


@app.get("/health")
def health():
    return {"status": "ok", "tools": [t["name"] for t in TOOLS]}


if __name__ == "__main__":
    print("Jarvis-Pro MCP HTTP server starting on http://0.0.0.0:8765/mcp")
    uvicorn.run(app, host="0.0.0.0", port=8765, log_level="info")
