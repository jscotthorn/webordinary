#!/bin/bash

# Run container with shell access for testing
# This allows interactive testing of S3 sync functionality

set -e

echo "🐚 Starting container with shell access..."

# Load environment variables
if [ -f .env.local ]; then
    set -a
    source .env.local
    set +a
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

# Run container with bash shell
docker run -it --rm \
  --platform linux/amd64 \
  --name claude-code-test \
  -v $WORKSPACE_DIR:/workspace \
  -v ~/.aws:/root/.aws:ro \
  -e NODE_ENV=development \
  -e AWS_PROFILE=${AWS_PROFILE} \
  -e AWS_REGION=${AWS_REGION} \
  -e CLIENT_ID=${CLIENT_ID} \
  -e DEFAULT_CLIENT_ID=${DEFAULT_CLIENT_ID} \
  -e DEFAULT_USER_ID=${DEFAULT_USER_ID} \
  -e WORKSPACE_PATH=${WORKSPACE_PATH} \
  -e GITHUB_TOKEN=${GITHUB_TOKEN} \
  -e ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY} \
  -e LOG_LEVEL=${LOG_LEVEL} \
  --entrypoint /bin/bash \
  webordinary/claude-code-s3:local

echo "✅ Container exited"