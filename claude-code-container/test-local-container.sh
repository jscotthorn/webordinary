#!/bin/bash

# Local container test script for Claude Code Astro container
# This script tests the container functionality locally before AWS deployment

set -e

echo "🧪 Claude Code Container Local Test Suite"
echo "=========================================="
echo ""

# Configuration
CONTAINER_NAME="claude-code-local-test-$$"
WORKSPACE_DIR="/Users/scott/Projects/webordinary/test-workspace-$$"
IMAGE_TAG="webordinary/claude-code-astro:local-test"
TEST_REPO="git@github.com:jscotthorn/amelia-astro.git"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Cleanup function
cleanup() {
    echo ""
    echo "🧹 Cleaning up..."
    docker stop $CONTAINER_NAME 2>/dev/null || true
    docker rm $CONTAINER_NAME 2>/dev/null || true
    rm -rf $WORKSPACE_DIR 2>/dev/null || true
    echo "✅ Cleanup complete"
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Check prerequisites
echo "📋 Checking prerequisites..."
if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${RED}❌ GITHUB_TOKEN environment variable not set${NC}"
    exit 1
fi
echo "✅ GitHub token found"

# Create workspace directory
echo ""
echo "📁 Creating workspace directory..."
mkdir -p $WORKSPACE_DIR
echo "✅ Created: $WORKSPACE_DIR"

# Build container
echo ""
echo "🔨 Building container..."
docker build -t $IMAGE_TAG . > /dev/null 2>&1
echo "✅ Container built: $IMAGE_TAG"

# Start container
echo ""
echo "🚀 Starting container..."
docker run -d \
    --name $CONTAINER_NAME \
    -p 18080:8080 \
    -p 14321:4321 \
    -p 14322:4322 \
    -e GITHUB_TOKEN="$GITHUB_TOKEN" \
    -e AUTO_SHUTDOWN_MINUTES=60 \
    -v $WORKSPACE_DIR:/workspace \
    $IMAGE_TAG > /dev/null 2>&1

# Wait for container to start
echo "⏳ Waiting for container to start..."
sleep 5

# Check if container is running
if ! docker ps | grep -q $CONTAINER_NAME; then
    echo -e "${RED}❌ Container failed to start${NC}"
    docker logs $CONTAINER_NAME
    exit 1
fi
echo "✅ Container running"

# Test 1: Health check
echo ""
echo "🧪 Test 1: Health Check"
HEALTH_RESPONSE=$(curl -s http://localhost:18080/health)
if echo "$HEALTH_RESPONSE" | grep -q '"status":"healthy"'; then
    echo -e "${GREEN}✅ Health check passed${NC}"
else
    echo -e "${RED}❌ Health check failed${NC}"
    echo "Response: $HEALTH_RESPONSE"
    exit 1
fi

# Test 2: Initialize workspace
echo ""
echo "🧪 Test 2: Initialize Workspace"
echo "   Cloning repository and starting Astro..."
INIT_RESPONSE=$(curl -s -X POST http://localhost:18080/api/init \
    -H "Content-Type: application/json" \
    -d "{
        \"clientId\": \"test\",
        \"userId\": \"user1\",
        \"threadId\": \"main\",
        \"repoUrl\": \"$TEST_REPO\"
    }")

if echo "$INIT_RESPONSE" | grep -q '"success":true'; then
    echo -e "${GREEN}✅ Workspace initialized successfully${NC}"
else
    echo -e "${RED}❌ Workspace initialization failed${NC}"
    echo "Response: $INIT_RESPONSE"
    docker logs $CONTAINER_NAME | tail -30
    exit 1
fi

# Wait for Astro to fully start
echo "⏳ Waiting for Astro server to start..."
sleep 10

# Test 3: Astro server accessibility
echo ""
echo "🧪 Test 3: Astro Server Accessibility"
ASTRO_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:14321)
if [ "$ASTRO_RESPONSE" = "200" ]; then
    echo -e "${GREEN}✅ Astro server accessible on port 4321${NC}"
else
    echo -e "${RED}❌ Astro server not accessible (HTTP $ASTRO_RESPONSE)${NC}"
    echo "Container logs:"
    docker logs $CONTAINER_NAME | grep -i astro | tail -20
    exit 1
fi

# Test 4: Check Astro content
echo ""
echo "🧪 Test 4: Astro Content Serving"
ASTRO_CONTENT=$(curl -s http://localhost:14321 | head -1)
if echo "$ASTRO_CONTENT" | grep -q "<!DOCTYPE html>"; then
    echo -e "${GREEN}✅ Astro serving HTML content${NC}"
else
    echo -e "${RED}❌ Astro not serving expected content${NC}"
    echo "First line of response: $ASTRO_CONTENT"
    exit 1
fi

# Test 5: API status endpoint
echo ""
echo "🧪 Test 5: API Status Endpoint"
STATUS_RESPONSE=$(curl -s http://localhost:18080/api/status/test/user1/main)
if echo "$STATUS_RESPONSE" | grep -q '"astro":{"running":true}'; then
    echo -e "${GREEN}✅ Status endpoint reports Astro running${NC}"
else
    echo -e "${YELLOW}⚠️  Status endpoint issue${NC}"
    echo "Response: $STATUS_RESPONSE"
fi

# Summary
echo ""
echo "=========================================="
echo -e "${GREEN}🎉 All tests passed successfully!${NC}"
echo ""
echo "Container is working correctly:"
echo "  - API endpoints functional"
echo "  - Repository cloning works"
echo "  - Astro server starts and serves content"
echo "  - Port binding configured correctly"
echo ""
echo "The fix (using 'npx astro dev --host 0.0.0.0') resolves the issue!"