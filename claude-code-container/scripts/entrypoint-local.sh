#!/bin/bash
# /app/scripts/entrypoint-local.sh
# Modified entrypoint for local development that's more forgiving

set -e

echo "=== Claude Code Container Starting (Local Development) ==="
echo "Timestamp: $(date)"
echo "Environment: ${NODE_ENV:-development}"

# In local development, AWS credentials might not work due to architecture issues
# We'll be more forgiving here
if [ "$NODE_ENV" = "development" ] && [ -n "$AWS_PROFILE" ]; then
  echo "📦 Development mode: Using AWS profile '${AWS_PROFILE}'"
  echo "⚠️  Skipping AWS credential verification (local development mode)"
  # Set the account ID manually if provided
  if [ -n "$AWS_ACCOUNT_ID" ]; then
    echo "✅ Using AWS Account ID: $AWS_ACCOUNT_ID"
  fi
elif [ "$NODE_ENV" = "production" ]; then
  echo "🚀 Production mode: Using IAM role credentials"
fi

# Check required environment variables - be more lenient in dev
if [ -z "$GITHUB_TOKEN" ]; then
  echo "Warning: GITHUB_TOKEN is not set - some features may not work"
  # Don't exit in development
  if [ "$NODE_ENV" = "production" ]; then
    exit 1
  fi
fi

# For local development, always use simulation mode for now
if [ -z "$ANTHROPIC_API_KEY" ] || [ "$ANTHROPIC_API_KEY" = "simulation-key" ]; then
  echo "📝 Using simulation mode for Claude API"
  export ANTHROPIC_API_KEY="simulation-key"
fi

# Configure git
echo "Configuring git..."
git config --global user.email "${GIT_USER_EMAIL:-claude@webordinary.com}"
git config --global user.name "${GIT_USER_NAME:-Claude Code Bot}"
git config --global credential.helper store
git config --global init.defaultBranch "${GIT_DEFAULT_BRANCH:-main}"

# Additional git configuration for container operations
git config --global --add safe.directory /workspace
git config --global pull.rebase false  # Use merge strategy for pulls

# Create necessary directories
mkdir -p /app/data /app/logs /app/tmp
mkdir -p /workspace

# Ensure proper permissions
echo "Setting up workspace permissions..."
if [ -d "/workspace" ]; then
  chmod 755 /workspace
fi

echo "✅ Container initialized successfully"
echo "==================================="

# Check if TypeScript app is built
if [ ! -f "/app/dist/main.js" ]; then
  echo "⚠️  TypeScript app not built, building now..."
  cd /app
  npm run build
fi

# Log queue configuration
echo "Queue Configuration:"
echo "  Unclaimed: ${UNCLAIMED_QUEUE_URL:-not set}"
echo "  Input: ${INPUT_QUEUE_URL:-not set}"
echo "  Output: ${OUTPUT_QUEUE_URL:-not set}"

# Start the NestJS application which will poll queues
echo "📊 Starting Queue Manager..."
cd /app
exec node dist/main.js