#!/bin/bash
# Run Claude Code Container locally (outside Docker) to use macOS Keychain auth

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Claude Code Container Locally${NC}"
echo "=================================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Must run from claude-code-container directory${NC}"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install
fi

# Check if dist exists
if [ ! -d "dist" ]; then
    echo -e "${YELLOW}Building TypeScript...${NC}"
    npm run build
fi

# Load environment variables from .env.local.hybrid (for local development)
# or .env.local if hybrid doesn't exist
if [ -f ".env.local.hybrid" ]; then
    echo -e "${GREEN}✓ Loading .env.local.hybrid (hybrid mode)${NC}"
    set -a
    source .env.local.hybrid
    set +a
elif [ -f ".env.local" ]; then
    echo -e "${GREEN}✓ Loading .env.local${NC}"
    set -a
    source .env.local
    set +a
else
    echo -e "${RED}Error: No environment file found${NC}"
    exit 1
fi

# Override for local development
export CLAUDE_CODE_USE_BEDROCK=0  # Use Anthropic API with your Claude login
export NODE_ENV=development
export WORKSPACE_PATH=/tmp/webordinary-workspace
export AWS_PROFILE=personal

# Create workspace directory if it doesn't exist
mkdir -p $WORKSPACE_PATH

echo ""
echo -e "${GREEN}Configuration:${NC}"
echo "  • Using Anthropic API (your Claude subscription)"
echo "  • Workspace: $WORKSPACE_PATH"
echo "  • AWS Profile: $AWS_PROFILE"
echo ""

# Start the NestJS application
echo -e "${YELLOW}Starting NestJS application...${NC}"
echo ""
node dist/main.js