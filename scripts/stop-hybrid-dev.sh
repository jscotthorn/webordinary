#!/bin/bash
# Stop hybrid development environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🛑 Stopping Hybrid Development Environment${NC}"
echo "=================================================="

# Stop Hermes container
echo -e "${YELLOW}Stopping Hermes Docker container...${NC}"
docker stop hermes-manual 2>/dev/null || true
docker rm hermes-manual 2>/dev/null || true
echo -e "${GREEN}✓ Hermes stopped${NC}"

# Stop Claude local process
if [ -f /tmp/claude-local.pid ]; then
    CLAUDE_PID=$(cat /tmp/claude-local.pid)
    if ps -p $CLAUDE_PID > /dev/null 2>&1; then
        echo -e "${YELLOW}Stopping Claude Code Container (PID: $CLAUDE_PID)...${NC}"
        kill $CLAUDE_PID 2>/dev/null || true
        echo -e "${GREEN}✓ Claude stopped${NC}"
    else
        echo -e "${YELLOW}Claude process not running${NC}"
    fi
    rm /tmp/claude-local.pid
else
    echo -e "${YELLOW}No Claude PID file found${NC}"
    # Try to find and kill any running node process for main.js
    pkill -f "node dist/main.js" 2>/dev/null || true
fi

# Clean up nohup.out if it exists
if [ -f /Users/scott/Projects/webordinary/claude-code-container/nohup.out ]; then
    rm /Users/scott/Projects/webordinary/claude-code-container/nohup.out
    echo -e "${GREEN}✓ Cleaned up nohup.out${NC}"
fi

# Optionally ask if user wants to clear logs
LOG_DIR="/tmp/webordinary-logs"
if [ -d "$LOG_DIR" ]; then
    echo -e "\n${YELLOW}Log files are preserved at: $LOG_DIR${NC}"
    echo "To clear logs, run: rm -rf $LOG_DIR"
fi

echo -e "\n${GREEN}✅ Hybrid development environment stopped${NC}"