#!/bin/bash

# Test script to verify container starts without REPO_URL

echo "Testing container startup without REPO_URL..."

# Set minimal required environment variables
export NODE_ENV=test
export AWS_REGION=us-west-2
export WORKSPACE_PATH=/tmp/test-workspace
export UNCLAIMED_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/942734823970/test-queue
export OWNERSHIP_TABLE_NAME=test-ownership

# Create workspace directory
mkdir -p $WORKSPACE_PATH

# Variables that should NOT be set
unset REPO_URL
unset CLIENT_ID
unset DEFAULT_CLIENT_ID
unset DEFAULT_USER_ID
unset AUTO_SHUTDOWN_MINUTES

echo "Environment check:"
echo "  REPO_URL: ${REPO_URL:-NOT SET (correct)}"
echo "  CLIENT_ID: ${CLIENT_ID:-NOT SET (correct)}"
echo "  DEFAULT_CLIENT_ID: ${DEFAULT_CLIENT_ID:-NOT SET (correct)}"
echo "  DEFAULT_USER_ID: ${DEFAULT_USER_ID:-NOT SET (correct)}"
echo ""

# Start the application with a timeout
echo "Starting container..."
timeout 5s node dist/main.js

EXIT_CODE=$?

if [ $EXIT_CODE -eq 124 ]; then
  echo "✅ Container started successfully (timed out after 5s as expected)"
  echo "Container is waiting for messages - no REPO_URL errors!"
  exit 0
elif [ $EXIT_CODE -eq 0 ]; then
  echo "✅ Container started and exited cleanly"
  exit 0
else
  echo "❌ Container failed to start (exit code: $EXIT_CODE)"
  exit 1
fi