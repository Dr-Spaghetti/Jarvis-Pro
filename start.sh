#!/usr/bin/env bash
# Start Jarvis-Pro backend servers (API + MCP + legacy dashboard)
# For the full Open WebUI experience: cd docker && docker compose up -d
# Usage: ./start.sh [port]
set -e

PORT=${1:-7860}
cd "$(dirname "$0")"

echo ""
echo "  ██ Jarvis-Pro"
echo "  ─────────────────────────────────────────────────"
echo "  Recommended: cd docker && docker compose up -d"
echo "               then open http://localhost:3000"
echo "  ─────────────────────────────────────────────────"
echo "  Legacy dashboard → http://localhost:$PORT"
echo "  API              → http://localhost:8000"
echo "  MCP tools        → http://localhost:8765/mcp"
echo "  ─────────────────────────────────────────────────"
echo ""

# Start API servers in background
PORT=8000 python serve.py > /tmp/jarvis-serve.log 2>&1 &
SERVE_PID=$!

PORT=8765 python mcp_http_server.py > /tmp/jarvis-mcp.log 2>&1 &
MCP_PID=$!

sleep 1

# Start the web UI in foreground
PORT=$PORT python webapp/app.py
