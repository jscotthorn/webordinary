#!/bin/bash
# /app/scripts/entrypoint.sh

set -e

echo "=== Claude Code Container Starting ==="
echo "Timestamp: $(date)"
echo "Environment: ${NODE_ENV:-development}"

# Check required environment variables
if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GITHUB_TOKEN is not set"
  exit 1
fi

# For Task 01, we'll use simulation mode
# In Task 03, ANTHROPIC_API_KEY will be replaced with Bedrock IAM role
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "Warning: ANTHROPIC_API_KEY not set - using simulation mode"
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
git config --global push.default simple

# Set up GitHub credentials
echo "https://${GITHUB_TOKEN}@github.com" > ~/.git-credentials
chmod 600 ~/.git-credentials

# Validate GitHub token
echo "Validating GitHub token..."
if curl -s -f -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user > /dev/null; then
  echo "✓ GitHub token is valid"
else
  echo "✗ GitHub token validation failed"
  exit 1
fi

# Ensure workspace directory exists (EFS mount point)
if [ ! -d "/workspace" ]; then
  echo "Error: /workspace directory not mounted"
  echo "This container requires an EFS volume mounted at /workspace"
  exit 1
fi

# Set proper permissions for EFS (only set root directory, not recursive)
# Recursive chown on EFS can take forever and cause health check failures
echo "Setting up workspace permissions..."
chmod 755 /workspace 2>/dev/null || true

# Create client directory if specified
if [ -n "$CLIENT_ID" ] && [ -n "$USER_ID" ]; then
  CLIENT_DIR="/workspace/${CLIENT_ID}/${USER_ID}"
  mkdir -p "$CLIENT_DIR" 2>/dev/null || true
  echo "Prepared client directory: $CLIENT_DIR"
fi

# Log environment info
echo "=== Environment Information ==="
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "Git version: $(git --version)"
echo "Workspace: /workspace"
echo "Client ID: ${CLIENT_ID:-not_set}"
echo "User ID: ${USER_ID:-not_set}"
echo "Thread ID: ${THREAD_ID:-not_set}"
echo "Auto-shutdown: ${AUTO_SHUTDOWN_MINUTES:-5} minutes"

# Start auto-shutdown timer in background
echo "Starting auto-shutdown monitor..."
/app/scripts/auto-shutdown.sh &
AUTO_SHUTDOWN_PID=$!

# Function to handle shutdown
shutdown_handler() {
  echo "Received shutdown signal..."
  
  # Kill auto-shutdown process
  if [ -n "$AUTO_SHUTDOWN_PID" ]; then
    kill $AUTO_SHUTDOWN_PID 2>/dev/null || true
  fi
  
  # Give the main process time to shut down gracefully
  sleep 2
  
  echo "Shutdown complete"
  exit 0
}

# Set up signal handlers
trap shutdown_handler SIGTERM SIGINT

# Start the application
echo "=== Starting Claude Code Server ==="
exec node /app/dist/server.js