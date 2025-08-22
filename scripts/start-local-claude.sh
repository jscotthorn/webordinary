#!/bin/bash
# Start local Claude container as part of the E2E chain
# This container will poll the unclaimed queue and process messages from Step Functions

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting local Claude container for E2E processing...${NC}"

# Check if container is already running
if [ "$(docker ps -q -f name=claude-local-e2e)" ]; then
    echo -e "${YELLOW}⚠️  Container 'claude-local-e2e' is already running${NC}"
    echo "Run ./scripts/stop-local-claude.sh first if you want to restart"
    exit 1
fi

# Clean up any stopped container with the same name
docker rm claude-local-e2e 2>/dev/null || true

# Load AWS credentials from personal profile
export AWS_ACCESS_KEY_ID=$(aws configure get aws_access_key_id --profile personal)
export AWS_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key --profile personal)

if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
    echo -e "${RED}❌ Failed to load AWS credentials from 'personal' profile${NC}"
    echo "Make sure you have configured: aws configure --profile personal"
    exit 1
fi

# Check for GitHub token
if [ -z "$GITHUB_TOKEN" ]; then
    # Try to load from hephaestus .env if it exists
    if [ -f "../hephaestus/.env" ]; then
        export GITHUB_TOKEN=$(grep GITHUB_TOKEN ../hephaestus/.env | cut -d '=' -f2)
    elif [ -f "hephaestus/.env" ]; then
        export GITHUB_TOKEN=$(grep GITHUB_TOKEN hephaestus/.env | cut -d '=' -f2)
    fi
    
    if [ -z "$GITHUB_TOKEN" ]; then
        echo -e "${RED}❌ GITHUB_TOKEN not set${NC}"
        echo "Please export GITHUB_TOKEN with write permissions to jscotthorn/amelia-astro"
        exit 1
    fi
fi

# Build the container if needed
if [ "$1" == "--build" ]; then
    echo -e "${GREEN}📦 Building container...${NC}"
    cd ../claude-code-container 2>/dev/null || cd claude-code-container
    npm run build
    docker build -t webordinary/claude-code-container:local --platform linux/amd64 .
    cd - > /dev/null
    IMAGE_TAG="local"
else
    # Use the final-fix image by default
    IMAGE_TAG="final-fix"
fi

# Start the container
echo -e "${GREEN}🐳 Starting container with image: webordinary/claude-code-container:${IMAGE_TAG}${NC}"

docker run -d \
  --name claude-local-e2e \
  --platform linux/amd64 \
  -e GITHUB_TOKEN="${GITHUB_TOKEN}" \
  -e AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
  -e AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
  -e AWS_REGION="us-west-2" \
  -e AWS_ACCOUNT_ID="942734823970" \
  -e CLAUDE_CODE_USE_BEDROCK=1 \
  -e WORKSPACE_PATH=/workspace \
  -e UNCLAIMED_QUEUE_URL="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed" \
  -e OWNERSHIP_TABLE="webordinary-container-ownership" \
  -e ACTIVE_JOBS_TABLE="webordinary-active-jobs" \
  -e GIT_PUSH_ENABLED=true \
  -e ANTHROPIC_MODEL="sonnet" \
  -e ANTHROPIC_SMALL_FAST_MODEL="haiku" \
  -e CLAUDE_CODE_MAX_OUTPUT_TOKENS="4096" \
  -e MAX_THINKING_TOKENS="1024" \
  webordinary/claude-code-container:${IMAGE_TAG}

# Wait for container to start
sleep 3

# Check if container is running
if [ "$(docker ps -q -f name=claude-local-e2e)" ]; then
    echo -e "${GREEN}✅ Container started successfully${NC}"
    echo ""
    echo "Container is now:"
    echo "  • Polling the unclaimed queue for work"
    echo "  • Ready to process messages from Step Functions"
    echo "  • Will claim ownership when messages arrive"
    echo "  • Will push to GitHub and deploy to S3"
    echo ""
    echo "To test the full flow:"
    echo "  1. Send a test email: ./scripts/test-aws-email.sh"
    echo "  2. Monitor logs: docker logs -f claude-local-e2e"
    echo "  3. Check Step Functions: AWS_PROFILE=personal aws stepfunctions list-executions --state-machine-arn arn:aws:states:us-west-2:942734823970:stateMachine:email-processor --max-items 1"
    echo ""
    echo "To stop: ./scripts/stop-local-claude.sh"
else
    echo -e "${RED}❌ Container failed to start${NC}"
    echo "Check logs with: docker logs claude-local-e2e"
    exit 1
fi