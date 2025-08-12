#!/bin/bash
# Stop local development environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "${YELLOW}🛑 Stopping WebOrdinary Local Development Environment${NC}"
echo "=================================================="

# Check if services are running
if docker compose -f docker-compose.local.yml ps --services --filter "status=running" | grep -q .; then
    echo -e "${YELLOW}Stopping services...${NC}"
    docker compose -f docker-compose.local.yml down
    echo -e "${GREEN}✓ Services stopped${NC}"
else
    echo -e "${YELLOW}No services are currently running${NC}"
fi

# Optional: Clean up volumes
if [ "$1" == "--clean" ]; then
    echo -e "\n${YELLOW}Cleaning up volumes...${NC}"
    docker compose -f docker-compose.local.yml down -v
    echo -e "${GREEN}✓ Volumes removed${NC}"
fi

echo -e "\n${GREEN}✅ Local development environment stopped${NC}"

if [ "$1" != "--clean" ]; then
    echo ""
    echo "Tip: Use '$0 --clean' to also remove volumes"
fi