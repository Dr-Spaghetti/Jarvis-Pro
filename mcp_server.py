"""
Jarvis-Pro MCP Server (stdio transport)

Exposes Jarvis skills and research as MCP tools so LibreChat agents
and any other MCP-compatible host can call them.

Run directly: python mcp_server.py
Or via Claude Code's mcpServers config.
"""
import json
import sys
from typing import Any

from core.config import settings
from core.registry import ClientRegistry
from skills import SKILL_REGISTRY

settings.ensure_jarvis_dirs()
registry = ClientRegistry()


def _make_tool(name: str, description: str, props: dict, required: list) -> dict:
    return {
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": props,
            "required": required,
        },
    }


TOOLS = [
    _make_tool(
        "list_clients",
        "List all active clients in the Jarvis registry.",
        {"active_only": {"type": "boolean", "default": True}},
        [],
    ),
    _make_tool(
        "list_skills",
        "List all available Jarvis skills.",
        {},
        [],
    ),
    _make_tool(
        "run_skill",
        "Run a Jarvis skill for one or more clients.",
        {
            "skill": {
                "type": "string",
                "description": "Skill name (e.g. citation-audit, falcon-report)",
                "enum": list(SKILL_REGISTRY.keys()),
            },
            "clients": {
                "type": "string",
                "description": "'all' or comma-separated client IDs",
            },
            "save_vault": {
                "type": "boolean",
                "default": False,
                "description": "Save output to Obsidian vault",
            },
        },
        ["skill", "clients"],
    ),
    _make_tool(
        "research",
        "Run the Jarvis research harness on a topic.",
        {
            "topic": {"type": "string"},
            "client_id": {"type": "string", "description": "Optional client context"},
            "depth": {"type": "integer", "default": 2, "minimum": 1, "maximum": 5},
            "save_vault": {"type": "boolean", "default": True},
        },
        ["topic"],
    ),
    _make_tool(
        "get_client",
        "Get full details for a specific client.",
        {"client_id": {"type": "string"}},
        ["client_id"],
    ),
    _make_tool(
        "skill_metrics",
        "Get performance metrics for a skill.",
        {"skill": {"type": "string"}},
        ["skill"],
    ),
]


def handle_call(tool_name: str, arguments: dict) -> Any:
    if tool_name == "list_clients":
        active_only = arguments.get("active_only", True)
        clients = registry.list(active_only=active_only)
        return [{"id": c.id, "name": c.name, "city": c.city, "state": c.state} for c in clients]

    if tool_name == "list_skills":
        return [
            {"name": k, "description": v.description}
            for k, v in SKILL_REGISTRY.items()
        ]

    if tool_name == "run_skill":
        skill_name = arguments["skill"]
        clients_spec = arguments.get("clients", "all")
        save_vault = arguments.get("save_vault", False)

        if skill_name not in SKILL_REGISTRY:
            return {"error": f"Unknown skill: {skill_name}"}

        clients_list = registry.resolve(
            "all" if clients_spec == "all" else [c.strip() for c in clients_spec.split(",")]
        )
        skill_cls = SKILL_REGISTRY[skill_name]
        skill = skill_cls()
        results = []
        for client in clients_list:
            r = skill.run(client, save_vault=save_vault)
            results.append(r.__dict__ if hasattr(r, "__dict__") else str(r))
        return results

    if tool_name == "research":
        from research.harness import ResearchHarness
        harness = ResearchHarness(registry=registry)
        result = harness.research(
            topic=arguments["topic"],
            client_id=arguments.get("client_id"),
            depth=arguments.get("depth", 2),
            save_to_vault=arguments.get("save_vault", True),
        )
        return result.to_dict()

    if tool_name == "get_client":
        client = registry.get(arguments["client_id"])
        if not client:
            return {"error": f"Client not found: {arguments['client_id']}"}
        return client.model_dump()

    if tool_name == "skill_metrics":
        from self_improvement.evaluator import SkillEvaluator
        ev = SkillEvaluator()
        m = ev.get_metrics(arguments["skill"])
        return {
            "skill": m.skill,
            "total_executions": m.total_executions,
            "success_rate": m.success_rate,
            "avg_duration_s": m.avg_duration_s,
            "needs_improvement": m.needs_improvement,
        }

    return {"error": f"Unknown tool: {tool_name}"}


def mcp_loop():
    """stdio MCP protocol loop."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = msg.get("method")
        msg_id = msg.get("id")

        if method == "initialize":
            resp = {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "jarvis-pro", "version": "0.1.0"},
                },
            }
        elif method == "tools/list":
            resp = {"jsonrpc": "2.0", "id": msg_id, "result": {"tools": TOOLS}}
        elif method == "tools/call":
            params = msg.get("params", {})
            tool_name = params.get("name")
            tool_args = params.get("arguments", {})
            try:
                content = handle_call(tool_name, tool_args)
                resp = {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "result": {
                        "content": [{"type": "text", "text": json.dumps(content, indent=2)}]
                    },
                }
            except Exception as exc:
                resp = {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "result": {
                        "content": [{"type": "text", "text": f"Error: {exc}"}],
                        "isError": True,
                    },
                }
        else:
            resp = {
                "jsonrpc": "2.0",
                "id": msg_id,
                "error": {"code": -32601, "message": f"Method not found: {method}"},
            }

        print(json.dumps(resp), flush=True)


if __name__ == "__main__":
    mcp_loop()
