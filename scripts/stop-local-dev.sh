#!/bin/bash
# Stop local development environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🛑 Stopping WebOrdinary Local Development Environment${NC}"
echo "=================================================="

# Stop containers
echo -e "${YELLOW}Stopping services...${NC}"
docker stop hermes-manual claude-manual 2>/dev/null || true
echo -e "${GREEN}✓ Services stopped${NC}"

# Optional: Remove containers
if [ "$1" == "--clean" ]; then
    echo -e "\n${YELLOW}Removing containers...${NC}"
    docker rm hermes-manual claude-manual 2>/dev/null || true
    echo -e "${GREEN}✓ Containers removed${NC}"
    
    echo -e "\n${YELLOW}Cleaning Docker build cache...${NC}"
    docker buildx prune -f
    echo -e "${GREEN}✓ Build cache cleaned${NC}"
fi

echo -e "\n${GREEN}✅ Local development environment stopped${NC}"

if [ "$1" != "--clean" ]; then
    echo ""
    echo "Tip: Use '$0 --clean' to also remove containers and clean cache"
fi