#!/bin/bash

# Enhanced Bedrock E2E test with detailed logging
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

print_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }
print_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Check prerequisites
if [ -z "${GITHUB_TOKEN:-}" ]; then
    print_error "GITHUB_TOKEN is not set"
    exit 1
fi

# Test parameters
PROJECT_ID="amelia"
USER_ID="bedrock-test-$(date +%s)"
THREAD_ID="thread-bedrock-$(date +%s)"
MESSAGE_ID="msg-$(date +%s)"
TASK_TOKEN="test-token-$(date +%s)"

# Queue URLs
UNCLAIMED_QUEUE="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed"
PROJECT_QUEUE="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-input-${PROJECT_ID}-${USER_ID}.fifo"

print_info "Starting enhanced Bedrock E2E test"
print_info "Project: $PROJECT_ID, User: $USER_ID"

# Clean up any old containers
docker stop claude-bedrock-test 2>/dev/null || true
docker rm claude-bedrock-test 2>/dev/null || true

# Start container with enhanced logging
print_info "Starting container with Bedrock configuration..."
docker run -d \
    --name claude-bedrock-test \
    --platform linux/amd64 \
    -e AWS_ACCESS_KEY_ID="$(aws configure get aws_access_key_id --profile personal)" \
    -e AWS_SECRET_ACCESS_KEY="$(aws configure get aws_secret_access_key --profile personal)" \
    -e AWS_REGION="us-west-2" \
    -e GITHUB_TOKEN="$GITHUB_TOKEN" \
    -e CLAUDE_CODE_USE_BEDROCK="1" \
    -e CLAUDE_SIMULATION_MODE="false" \
    -e NODE_ENV="production" \
    -e LOG_LEVEL="debug" \
    -e UNCLAIMED_QUEUE_URL="$UNCLAIMED_QUEUE" \
    -e THREAD_MAPPINGS_TABLE="webordinary-thread-mappings" \
    -e OWNERSHIP_TABLE="webordinary-container-ownership" \
    -e S3_BUCKET_PREFIX="edit" \
    -e S3_BUCKET_SUFFIX="webordinary.com" \
    -e WORKSPACE_PATH="/workspace" \
    -v "$(pwd)/workspace:/workspace" \
    -v "$HOME/.aws:/home/appuser/.aws:ro" \
    webordinary/claude-code-test:latest

print_info "Waiting for container initialization..."
sleep 3

# Check container is running
if ! docker ps | grep -q claude-bedrock-test; then
    print_error "Container failed to start"
    docker logs claude-bedrock-test
    exit 1
fi

# Create FIFO queue for project
print_info "Creating FIFO queue: $PROJECT_QUEUE"
AWS_PROFILE=personal aws sqs create-queue \
    --queue-name "webordinary-input-${PROJECT_ID}-${USER_ID}.fifo" \
    --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"true"}' \
    --region us-west-2 2>/dev/null || print_warn "Queue may already exist"

# Send CLAIM_REQUEST
print_info "Sending CLAIM_REQUEST to unclaimed queue..."
CLAIM_MESSAGE='{
    "type": "CLAIM_REQUEST",
    "projectId": "'$PROJECT_ID'",
    "userId": "'$USER_ID'",
    "threadId": "'$THREAD_ID'",
    "messageId": "'$MESSAGE_ID'",
    "queueUrl": "'$PROJECT_QUEUE'",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
}'

AWS_PROFILE=personal aws sqs send-message \
    --queue-url "$UNCLAIMED_QUEUE" \
    --message-body "$CLAIM_MESSAGE" \
    --region us-west-2 > /dev/null

print_info "Waiting for container to claim ownership..."
sleep 5

# Check ownership in DynamoDB
print_info "Checking ownership in DynamoDB..."
OWNERSHIP=$(AWS_PROFILE=personal aws dynamodb get-item \
    --table-name webordinary-container-ownership \
    --key '{"projectKey":{"S":"'$PROJECT_ID'#'$USER_ID'"}}' \
    --region us-west-2 \
    --query 'Item.containerId.S' \
    --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$OWNERSHIP" != "NOT_FOUND" ]; then
    print_info "✅ Container claimed ownership: $OWNERSHIP"
else
    print_warn "⚠️ No ownership claim found"
fi

# Send work message
print_info "Sending work message to project queue..."
WORK_MESSAGE='{
    "projectId": "'$PROJECT_ID'",
    "userId": "'$USER_ID'",
    "threadId": "'$THREAD_ID'",
    "messageId": "work-'$(date +%s)'",
    "content": "Create a simple test.html file with the title Bedrock E2E Test Success and a paragraph saying This file was created by Claude via AWS Bedrock",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "repoUrl": "https://github.com/jscotthorn/amelia-astro.git",
    "branch": "'$THREAD_ID'",
    "taskToken": "'$TASK_TOKEN'"
}'

AWS_PROFILE=personal aws sqs send-message \
    --queue-url "$PROJECT_QUEUE" \
    --message-body "$WORK_MESSAGE" \
    --message-deduplication-id "$(date +%s)" \
    --message-group-id "${PROJECT_ID}-${USER_ID}" \
    --region us-west-2 > /dev/null

print_info "Message sent, monitoring container logs..."

# Monitor logs with pattern matching
MONITOR_TIMEOUT=60
START_TIME=$(date +%s)

while true; do
    ELAPSED=$(($(date +%s) - START_TIME))
    if [ $ELAPSED -gt $MONITOR_TIMEOUT ]; then
        print_warn "Monitoring timeout reached"
        break
    fi
    
    # Check for key log patterns
    if docker logs claude-bedrock-test 2>&1 | grep -q "Using Claude Code SDK with Bedrock"; then
        print_info "✅ Bedrock mode confirmed"
        break
    fi
    
    if docker logs claude-bedrock-test 2>&1 | grep -q "Pushed branch"; then
        print_info "✅ Git push completed!"
        break
    fi
    
    if docker logs claude-bedrock-test 2>&1 | grep -q "Claude Code SDK execution failed"; then
        print_error "❌ SDK execution failed"
        break
    fi
    
    sleep 2
done

# Show recent logs
print_info "Recent container logs:"
docker logs claude-bedrock-test --tail 30 2>&1 | grep -E "(ClaudeExecutor|GitService|S3Sync|ERROR)"

# Check for file creation
print_info "Checking workspace for created files..."
if [ -f "workspace/$PROJECT_ID/$USER_ID/amelia-astro/test.html" ]; then
    print_info "✅ Test file created locally!"
    cat "workspace/$PROJECT_ID/$USER_ID/amelia-astro/test.html"
else
    print_warn "⚠️ Test file not found locally"
fi

# Check GitHub for branch
print_info "Checking GitHub for new branch..."
if git ls-remote --heads origin "$THREAD_ID" 2>/dev/null | grep -q "$THREAD_ID"; then
    print_info "✅ Branch pushed to GitHub: $THREAD_ID"
else
    print_warn "⚠️ Branch not found on GitHub"
fi

# Check S3 deployment
print_info "Checking S3 deployment..."
S3_PATH="s3://edit.amelia.webordinary.com/$USER_ID/"
if AWS_PROFILE=personal aws s3 ls "$S3_PATH" 2>/dev/null | grep -q "test.html"; then
    print_info "✅ Files deployed to S3!"
else
    print_warn "⚠️ Files not found in S3"
fi

# Final status
print_info "\n=== Test Summary ==="
echo "Project: $PROJECT_ID"
echo "User: $USER_ID"
echo "Thread: $THREAD_ID"
echo "Container: claude-bedrock-test"
echo ""
echo "To view full logs: docker logs claude-bedrock-test"
echo "To cleanup: docker stop claude-bedrock-test && docker rm claude-bedrock-test"

# Keep container running for debugging
print_info "Container left running for debugging. Use cleanup command above when done."