#!/bin/bash
# Start local development environment with Docker Compose

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

# Verify Bedrock access
echo -e "\n${YELLOW}Verifying Bedrock access...${NC}"
if ./claude-code-container/scripts/verify-bedrock.sh > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Bedrock access confirmed${NC}"
else
    echo -e "${YELLOW}⚠️  Bedrock access not verified - local development will use simulation mode${NC}"
fi

# Check for running containers
echo -e "\n${YELLOW}Checking for running containers...${NC}"
if docker compose -f docker-compose.local.yml ps --services --filter "status=running" | grep -q .; then
    echo -e "${YELLOW}Stopping existing containers...${NC}"
    docker compose -f docker-compose.local.yml down
fi

# Build containers
echo -e "\n${YELLOW}Building containers...${NC}"
docker compose -f docker-compose.local.yml build

# Start services
echo -e "\n${YELLOW}Starting services...${NC}"
docker compose -f docker-compose.local.yml up -d

# Wait for services to be healthy
echo -e "\n${YELLOW}Waiting for services to be healthy...${NC}"
RETRIES=30
while [ $RETRIES -gt 0 ]; do
    if docker compose -f docker-compose.local.yml ps | grep -q "unhealthy"; then
        echo -n "."
        sleep 2
        RETRIES=$((RETRIES-1))
    else
        break
    fi
done

echo ""

# Check service status
echo -e "\n${GREEN}Service Status:${NC}"
docker compose -f docker-compose.local.yml ps

# Show logs command
echo -e "\n${GREEN}✅ Local development environment started!${NC}"
echo ""
echo "Services:"
echo "  • Hermes API: http://localhost:3000/hermes/health"
echo "  • Claude Container: Running (no HTTP, S3 deployment mode)"
echo ""
echo "Useful commands:"
echo "  • View logs: docker compose -f docker-compose.local.yml logs -f"
echo "  • Stop services: docker compose -f docker-compose.local.yml down"
echo "  • Restart services: docker compose -f docker-compose.local.yml restart"
echo "  • View Hermes logs: docker compose -f docker-compose.local.yml logs -f hermes"
echo "  • View Claude logs: docker compose -f docker-compose.local.yml logs -f claude-container"
echo ""
echo "AWS Resources (using profile 'personal'):"
echo "  • DynamoDB tables: webordinary-queue-tracking, webordinary-thread-mappings"
echo "  • SQS queue: webordinary-email-queue"
echo "  • S3 bucket: edit.amelia.webordinary.com"