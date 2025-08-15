#!/bin/bash
# Start local development environment
# This replaces the broken docker-compose approach with direct Docker commands

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "${GREEN}🚀 Starting WebOrdinary Local Development Environment${NC}"
echo "=================================================="

# Check prerequisites
echo -e "\n${YELLOW}Checking prerequisites...${NC}"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    echo "Please install Docker Desktop from https://www.docker.com/products/docker-desktop"
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
echo -e "\n${YELLOW}Checking environment files...${NC}"

if [ ! -f "hermes/.env.local" ]; then
    echo -e "${YELLOW}Creating hermes/.env.local from template...${NC}"
    cp hermes/.env.local.example hermes/.env.local
    echo -e "${GREEN}✓ Created hermes/.env.local - please update with your values${NC}"
fi

if [ ! -f "claude-code-container/.env.local" ]; then
    echo -e "${YELLOW}Creating claude-code-container/.env.local from template...${NC}"
    cp claude-code-container/.env.local.example claude-code-container/.env.local
    echo -e "${GREEN}✓ Created claude-code-container/.env.local - please update with your values${NC}"
fi

# Check critical configuration
echo -e "\n${YELLOW}Checking critical configuration...${NC}"

# Check WORKSPACE_PATH
if grep -q "WORKSPACE_PATH=/workspace/amelia-astro" claude-code-container/.env.local 2>/dev/null; then
    echo -e "${RED}❌ WORKSPACE_PATH is incorrect in claude-code-container/.env.local${NC}"
    echo "   It must be: WORKSPACE_PATH=/workspace"
    echo "   Please fix this before continuing"
    exit 1
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

# Clear Docker build cache if requested
if [ "$1" == "--clean" ]; then
    echo -e "\n${YELLOW}Clearing Docker build cache...${NC}"
    docker buildx prune -af
fi

# Build Hermes
echo -e "\n${YELLOW}Building Hermes...${NC}"
docker build -t webordinary-hermes ./hermes/

# Build Claude Container
echo -e "\n${YELLOW}Building Claude Container...${NC}"
docker build -t webordinary-claude-container ./claude-code-container/

# Start Hermes
echo -e "\n${YELLOW}Starting Hermes...${NC}"
docker run -d --name hermes-manual \
  --env-file hermes/.env.local \
  -e AWS_PROFILE=personal \
  -v ~/.aws:/home/hermes/.aws:ro \
  --network webordinary_webordinary-local \
  webordinary-hermes

# Start Claude Container
echo -e "\n${YELLOW}Starting Claude Container...${NC}"
docker run -d --name claude-manual \
  --env-file claude-code-container/.env.local \
  -e AWS_PROFILE=personal \
  -v ~/.aws:/home/appuser/.aws:ro \
  -v ~/.claude:/home/appuser/.claude:ro \
  --network webordinary_webordinary-local \
  --entrypoint node \
  webordinary-claude-container dist/main.js

# Wait for services to start
echo -e "\n${YELLOW}Waiting for services to initialize...${NC}"
sleep 5

# Check status
echo -e "\n${GREEN}Service Status:${NC}"
docker ps --filter "name=hermes-manual" --filter "name=claude-manual"

echo -e "\n${GREEN}✅ Local development environment started!${NC}"
echo ""
echo "Next steps:"
echo "  1. Send test email: ./scripts/send-test-email.sh"
echo "  2. Monitor logs: docker logs -f claude-manual"
echo "  3. Check status: ./scripts/check-local-status.sh"
echo ""
echo "Useful commands:"
echo "  • View Hermes logs: docker logs -f hermes-manual"
echo "  • View Claude logs: docker logs -f claude-manual"
echo "  • Stop services: docker stop hermes-manual claude-manual"
echo "  • Restart with clean cache: ./scripts/start-local-dev.sh --clean"
echo ""
echo "AWS Resources (using profile 'personal'):"
echo "  • DynamoDB tables: webordinary-queue-tracking, webordinary-thread-mappings"
echo "  • SQS queues: webordinary-email-queue, webordinary-unclaimed"
echo "  • GitHub repo: https://github.com/jscotthorn/amelia-astro"