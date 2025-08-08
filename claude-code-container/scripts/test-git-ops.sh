#!/bin/bash
# Test script for enhanced git operations

set -e

echo "=== Testing Enhanced Git Operations ==="

# Configuration
CONTAINER_URL="http://localhost:8080"
CLIENT_ID="test-client"
USER_ID="test-user"
THREAD_ID="git-test-$(date +%s)"

echo "Using Thread ID: $THREAD_ID"

# Check if GitHub token is set
if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GITHUB_TOKEN environment variable is required"
  exit 1
fi

# Function to make API call
api_call() {
  local method=$1
  local endpoint=$2
  local data=$3
  
  if [ -n "$data" ]; then
    curl -s -X $method "$CONTAINER_URL$endpoint" \
      -H "Content-Type: application/json" \
      -d "$data" | jq '.'
  else
    curl -s -X $method "$CONTAINER_URL$endpoint" | jq '.'
  fi
}

echo "=== Step 1: Initialize workspace ==="
api_call POST "/api/init" '{
  "clientId": "'$CLIENT_ID'",
  "userId": "'$USER_ID'",
  "threadId": "'$THREAD_ID'",
  "repoUrl": "https://github.com/withastro/blog-template.git"
}'

echo "=== Step 2: Get enhanced git status ==="
api_call GET "/api/git/status/$CLIENT_ID/$USER_ID/$THREAD_ID"

echo "=== Step 3: Create a test file and commit ==="
# Create test file via container file system (would normally be done by Claude)
WORKSPACE_PATH="/workspace/$CLIENT_ID/$USER_ID/project"

# This would be done by Claude Code, but we'll simulate it
echo "# Test file created by git operations test" > "$WORKSPACE_PATH/test-git-ops.md"

echo "=== Step 4: Smart commit with auto-push ==="
api_call POST "/api/git/commit/$CLIENT_ID/$USER_ID/$THREAD_ID" '{
  "message": "Add test file for git operations validation"
}'

echo "=== Step 5: Check git status after commit ==="
api_call GET "/api/git/status/$CLIENT_ID/$USER_ID/$THREAD_ID"

echo "=== Step 6: Fetch from remote ==="
api_call POST "/api/git/fetch/$CLIENT_ID/$USER_ID/$THREAD_ID" '{}'

echo "=== Step 7: Switch to main branch ==="
api_call POST "/api/git/branch/$CLIENT_ID/$USER_ID/$THREAD_ID" '{
  "branch": "main"
}'

echo "=== Step 8: Switch back to thread branch ==="
api_call POST "/api/git/branch/$CLIENT_ID/$USER_ID/$THREAD_ID" '{
  "branch": "thread-'$THREAD_ID'"
}'

echo "=== Git Operations Test Complete! ==="
echo "Thread branch: thread-$THREAD_ID"
echo "Check GitHub repository for the pushed branch and changes."