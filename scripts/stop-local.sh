#!/bin/bash
# Unified local development environment shutdown script
# Stops all local development services

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     🛑 Stopping Local Development Environment      ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════╝${NC}"
echo ""

# Stop Claude if running
if [ -f /tmp/claude-local.pid ]; then
    CLAUDE_PID=$(cat /tmp/claude-local.pid)
    if ps -p $CLAUDE_PID > /dev/null 2>&1; then
        echo -e "${YELLOW}▶ Stopping Claude Code Container (PID: $CLAUDE_PID)...${NC}"
        kill $CLAUDE_PID 2>/dev/null || true
        sleep 2
        # Force kill if still running
        if ps -p $CLAUDE_PID > /dev/null 2>&1; then
            kill -9 $CLAUDE_PID 2>/dev/null || true
        fi
        echo -e "${GREEN}✓ Claude stopped${NC}"
    fi
    rm /tmp/claude-local.pid
fi

# Stop LocalStack
echo -e "${YELLOW}▶ Stopping LocalStack...${NC}"
docker stop localstack-main 2>/dev/null || true
docker rm localstack-main 2>/dev/null || true
echo -e "${GREEN}✓ LocalStack stopped${NC}"

# Stop any legacy containers (cleanup)
for container in localstack-manual claude-manual hermes-manual; do
    if docker ps -a | grep -q $container; then
        echo -e "${YELLOW}▶ Cleaning up legacy container: $container${NC}"
        docker stop $container 2>/dev/null || true
        docker rm $container 2>/dev/null || true
    fi
done

echo ""
echo -e "${GREEN}✅ All services stopped${NC}"
echo ""
echo "To restart: ./scripts/start-local.sh"