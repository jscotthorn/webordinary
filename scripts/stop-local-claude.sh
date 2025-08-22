#!/bin/bash
# Stop local Claude container

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🛑 Stopping local Claude container...${NC}"

# Check if container exists
if [ ! "$(docker ps -a -q -f name=claude-local-e2e)" ]; then
    echo -e "${YELLOW}⚠️  Container 'claude-local-e2e' not found${NC}"
    exit 0
fi

# Get container status
if [ "$(docker ps -q -f name=claude-local-e2e)" ]; then
    # Container is running
    echo "📊 Container statistics:"
    docker stats claude-local-e2e --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}"
    
    # Show recent logs
    echo ""
    echo "📜 Last 10 log lines:"
    docker logs claude-local-e2e --tail 10
    
    # Stop the container
    echo ""
    echo "Stopping container..."
    docker stop claude-local-e2e > /dev/null
    echo -e "${GREEN}✅ Container stopped${NC}"
else
    echo "Container already stopped"
fi

# Remove the container
echo "Removing container..."
docker rm claude-local-e2e > /dev/null
echo -e "${GREEN}✅ Container removed${NC}"

# Check for any active jobs in DynamoDB
echo ""
echo "🔍 Checking for active jobs..."
AWS_PROFILE=personal aws dynamodb scan \
  --table-name webordinary-container-ownership \
  --filter-expression "attribute_exists(containerId)" \
  --projection-expression "projectKey, containerId, claimedAt" \
  --max-items 3 \
  --output table 2>/dev/null || echo "No active ownership claims found"

echo ""
echo -e "${GREEN}✅ Local Claude container stopped and cleaned up${NC}"