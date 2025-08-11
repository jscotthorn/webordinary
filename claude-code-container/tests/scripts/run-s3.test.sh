#!/bin/bash

# Non-interactive test of S3 sync functionality

set -e

echo "🧪 Running S3 Sync Test (Non-Interactive)"
echo "=========================================="

# Load environment variables
if [ -f .env.local ]; then
    set -a
    source .env.local
    set +a
fi

# Get the project root directory
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Build the container first
echo "🔨 Building container image..."
if docker build --platform linux/amd64 -t webordinary/claude-code-s3:local "$PROJECT_ROOT" > /dev/null 2>&1; then
    echo "✅ Container image built"
else
    echo "❌ Failed to build container image"
    exit 1
fi

# Prepare workspace
WORKSPACE_DIR="/tmp/workspace"
if [ ! -d "$WORKSPACE_DIR/amelia-astro" ]; then
    echo "📁 Setting up workspace..."
    mkdir -p $WORKSPACE_DIR
    if [ -d "/Users/scott/Projects/webordinary/amelia-astro" ]; then
        cp -r /Users/scott/Projects/webordinary/amelia-astro $WORKSPACE_DIR/
        echo "✅ Copied Astro project to workspace"
    fi
fi

echo ""
echo "🐳 Running container test..."
echo ""

# Run the test script inside the container (override entrypoint)
docker run --rm \
  --platform linux/amd64 \
  --entrypoint /bin/bash \
  -v "$WORKSPACE_DIR:/workspace" \
  -v ~/.aws:/home/appuser/.aws:ro \
  -v "$PROJECT_ROOT/tests/scripts/test-s3-sync.sh:/test-s3-sync.sh" \
  -e NODE_ENV=development \
  -e "AWS_PROFILE=${AWS_PROFILE:-personal}" \
  -e "AWS_REGION=${AWS_REGION:-us-west-2}" \
  -e "CLIENT_ID=${CLIENT_ID:-amelia}" \
  -e "DEFAULT_CLIENT_ID=${DEFAULT_CLIENT_ID:-amelia}" \
  -e "DEFAULT_USER_ID=${DEFAULT_USER_ID:-test@example.com}" \
  -e "WORKSPACE_PATH=/workspace" \
  -e "GITHUB_TOKEN=${GITHUB_TOKEN}" \
  -e "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" \
  webordinary/claude-code-s3:local \
  -c "chmod +x /test-s3-sync.sh && /test-s3-sync.sh"

echo ""
echo "✅ Container test complete!"