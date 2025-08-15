#!/bin/bash
# Start hybrid development environment
# Hermes in Docker, Claude Code Container running locally

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "${BLUE}🚀 Starting Hybrid Development Environment${NC}"
echo "=================================================="
echo "Hermes: Docker container"
echo "Claude: Local process (uses your Claude subscription)"
echo ""

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    exit 1
fi

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    echo "Please install Node.js: brew install node"
    exit 1
fi

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed${NC}"
    echo "Please install AWS CLI: brew install awscli"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity --profile personal &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not configured${NC}"
    echo "Please run: aws configure --profile personal"
    exit 1
fi

# Check for .env.local files
if [ ! -f "hermes/.env.local" ]; then
    echo -e "${YELLOW}Creating hermes/.env.local from template...${NC}"
    cp hermes/.env.local.example hermes/.env.local
    echo -e "${GREEN}✓ Created hermes/.env.local${NC}"
fi

if [ ! -f "claude-code-container/.env.local" ]; then
    echo -e "${YELLOW}Creating claude-code-container/.env.local from template...${NC}"
    cp claude-code-container/.env.local.example claude-code-container/.env.local
    echo -e "${GREEN}✓ Created claude-code-container/.env.local${NC}"
fi

# Create Docker network if it doesn't exist
if ! docker network ls | grep -q webordinary_webordinary-local; then
    echo -e "\n${YELLOW}Creating Docker network...${NC}"
    docker network create webordinary_webordinary-local
fi

# Stop any existing containers
echo -e "\n${YELLOW}Stopping existing containers...${NC}"
docker stop hermes-manual claude-manual 2>/dev/null || true
docker rm hermes-manual claude-manual 2>/dev/null || true

# Build Hermes
echo -e "\n${YELLOW}Building Hermes Docker image...${NC}"
docker build -t webordinary-hermes ./hermes/

# Start Hermes in Docker
echo -e "\n${YELLOW}Starting Hermes in Docker...${NC}"
docker run -d --name hermes-manual \
  --env-file hermes/.env.local \
  -e AWS_PROFILE=personal \
  -v ~/.aws:/home/hermes/.aws:ro \
  --network webordinary_webordinary-local \
  -p 3000:3000 \
  webordinary-hermes

# Build Claude Code Container locally
echo -e "\n${YELLOW}Building Claude Code Container locally...${NC}"
cd claude-code-container
npm install
npm run build

# Create log files for output
LOG_DIR="/tmp/webordinary-logs"
mkdir -p "$LOG_DIR"
CLAUDE_LOG="$LOG_DIR/claude-output.log"
echo "" > "$CLAUDE_LOG"  # Clear previous log

# Start Claude Code Container locally in background with output redirection
echo -e "\n${YELLOW}Starting Claude Code Container locally...${NC}"
# Use nohup to prevent SIGHUP when terminal closes
nohup ./run-local.sh > "$CLAUDE_LOG" 2>&1 &
CLAUDE_PID=$!
cd ..

# Save PID for stop script
echo $CLAUDE_PID > /tmp/claude-local.pid

# Wait a moment for services to start
echo -e "\n${YELLOW}Waiting for services to initialize...${NC}"
sleep 5

# Check status
echo -e "\n${GREEN}Service Status:${NC}"
echo "Hermes (Docker):"
docker ps --filter "name=hermes-manual"
echo ""
echo "Claude (Local Process):"
if ps -p $CLAUDE_PID > /dev/null; then
    echo -e "${GREEN}✓ Claude Code Container running (PID: $CLAUDE_PID)${NC}"
    echo -e "${GREEN}✓ Logs: tail -f $CLAUDE_LOG${NC}"
else
    echo -e "${RED}❌ Claude Code Container failed to start${NC}"
    echo "Check logs at: $CLAUDE_LOG"
    tail -20 "$CLAUDE_LOG"
    exit 1
fi

echo -e "\n${GREEN}✅ Hybrid development environment started!${NC}"
echo ""
echo "Commands:"
echo "  • Send test email:      ./scripts/send-test-email.sh"
echo "  • Monitor Hermes logs:  docker logs -f hermes-manual"
echo "  • Monitor Claude logs:  tail -f $CLAUDE_LOG"
echo "  • Check status:         ./scripts/check-hybrid-status.sh"
echo "  • Stop services:        ./scripts/stop-hybrid-dev.sh"
echo ""
echo -e "${YELLOW}Services running in background. Terminal is free for other commands.${NC}"
echo ""
echo "Quick monitor (showing last 10 lines of Claude log):"
echo "----------------------------------------"
tail -10 "$CLAUDE_LOG"