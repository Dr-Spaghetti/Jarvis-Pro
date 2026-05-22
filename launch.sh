#!/usr/bin/env bash
# Jarvis-Pro launcher — starts MCP server + Open WebUI in one command
set -e

cd "$(dirname "$0")"

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo ""
  echo "  ERROR: ANTHROPIC_API_KEY is not set."
  echo "  Run: export ANTHROPIC_API_KEY=sk-ant-api03-..."
  echo ""
  exit 1
fi

export WEBUI_AUTH=false
export WEBUI_SECRET_KEY="${WEBUI_SECRET_KEY:-jarvis-local-secret}"
export WEBUI_URL="${WEBUI_URL:-http://localhost:8080}"
export MCP_SELF_URL="${MCP_SELF_URL:-http://localhost:8765/mcp}"
unset WEBUI_ADMIN_EMAIL
unset WEBUI_ADMIN_PASSWORD

echo ""
echo "  ██ Jarvis-Pro"
echo "  ──────────────────────────────────"
echo "  Chat UI  →  http://localhost:8080"
echo "  MCP      →  http://localhost:8765/mcp"
echo "  ──────────────────────────────────"
echo ""

# Start MCP tool server in background
python mcp_http_server.py > /tmp/jarvis-mcp.log 2>&1 &
MCP_PID=$!
echo "  MCP server started (pid $MCP_PID)"

# Auto-configure Open WebUI after it boots (runs in background)
(sleep 20 && python docker/setup_webui.py) &

echo "  Open WebUI starting — ready in ~15 seconds"
echo ""

# Start Open WebUI in foreground
open-webui serve
