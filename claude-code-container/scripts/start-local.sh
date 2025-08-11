#!/bin/bash

# Claude Code Container Local Development Starter Script
# This script runs the container locally with AWS credentials

set -e

echo "🚀 Starting Claude Code Container in local development mode..."

# Check for required files
if [ ! -f .env.local ]; then
    echo "⚠️  .env.local not found. Creating from example..."
    cp .env.local.example .env.local
    echo "📝 Please update .env.local with your configuration"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity --profile personal > /dev/null 2>&1; then
    echo "❌ AWS credentials not configured for 'personal' profile"
    echo "Please run: aws configure --profile personal"
    exit 1
fi

# Load environment variables
set -a
source .env.local
set +a

# Verify AWS access
echo "✅ AWS Account: $(aws sts get-caller-identity --profile personal --query Account --output text)"

# Check if S3 bucket exists
echo "🔍 Checking S3 bucket..."
if aws s3 ls s3://${S3_BUCKET_NAME} --profile personal > /dev/null 2>&1; then
    echo "✅ S3 bucket ${S3_BUCKET_NAME} is accessible"
else
    echo "❌ S3 bucket ${S3_BUCKET_NAME} not accessible"
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
    else
        echo "⚠️  Astro project not found, workspace will be empty"
    fi
fi

# Build the Docker image if needed
echo "🔨 Building Docker image..."
docker build --platform linux/amd64 -t webordinary/claude-code-s3:local .

# Run the container with local AWS credentials
echo "🎯 Starting container..."
echo "📝 Logs will appear below. Press Ctrl+C to stop."
echo "-------------------------------------------"

docker run --rm \
  --platform linux/amd64 \
  --name claude-code-local \
  -v $WORKSPACE_DIR:/workspace \
  -v ~/.aws:/home/appuser/.aws:ro \
  -e NODE_ENV=development \
  -e AWS_PROFILE=${AWS_PROFILE} \
  -e AWS_REGION=${AWS_REGION} \
  -e CLIENT_ID=${CLIENT_ID} \
  -e DEFAULT_CLIENT_ID=${DEFAULT_CLIENT_ID} \
  -e DEFAULT_USER_ID=${DEFAULT_USER_ID} \
  -e WORKSPACE_PATH=${WORKSPACE_PATH} \
  -e GITHUB_TOKEN=${GITHUB_TOKEN} \
  -e ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY} \
  -e INPUT_QUEUE_URL=${INPUT_QUEUE_URL} \
  -e OUTPUT_QUEUE_URL=${OUTPUT_QUEUE_URL} \
  -e LOG_LEVEL=${LOG_LEVEL} \
  -e AUTO_SHUTDOWN_MINUTES=${AUTO_SHUTDOWN_MINUTES} \
  webordinary/claude-code-s3:local