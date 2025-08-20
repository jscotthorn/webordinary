#!/bin/bash

# Test container with actual SQS message
set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

print_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Configuration
PROJECT_ID="amelia"
USER_ID="test-user-$(date +%s)"
THREAD_ID="test-thread-$(date +%s)"
UNCLAIMED_QUEUE="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed"

# Create test message
create_test_message() {
    cat <<EOF
{
  "type": "CLAIM_REQUEST",
  "projectId": "$PROJECT_ID",
  "userId": "$USER_ID",
  "threadId": "$THREAD_ID",
  "messageId": "msg-$(date +%s)",
  "content": "Create a simple index.html file with 'Hello from Docker E2E test' as content",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "repoUrl": "https://github.com/jscotthorn/amelia-astro.git",
  "branch": "thread-$THREAD_ID",
  "taskToken": "test-token-$(date +%s)"
}
EOF
}

# Send message to queue
send_message() {
    local message=$(create_test_message)
    print_info "Sending test message to unclaimed queue..."
    print_info "Message: $message"
    
    AWS_PROFILE=personal aws sqs send-message \
        --queue-url "$UNCLAIMED_QUEUE" \
        --message-body "$message" \
        --output json
}

# Start container in background
start_container() {
    print_info "Starting container in background..."
    
    cd /Users/scott/Projects/webordinary/claude-code-container
    
    docker run -d \
        --name claude-e2e-test \
        -e AWS_ACCESS_KEY_ID="$(aws configure get aws_access_key_id --profile personal)" \
        -e AWS_SECRET_ACCESS_KEY="$(aws configure get aws_secret_access_key --profile personal)" \
        -e AWS_REGION="us-west-2" \
        -e GITHUB_TOKEN="$GITHUB_TOKEN" \
        -e UNCLAIMED_QUEUE_URL="$UNCLAIMED_QUEUE" \
        -e THREAD_MAPPINGS_TABLE="webordinary-thread-mappings" \
        -e OWNERSHIP_TABLE="webordinary-container-ownership" \
        -e ACTIVE_JOBS_TABLE="webordinary-active-jobs" \
        -e S3_BUCKET_PREFIX="edit" \
        -e S3_BUCKET_SUFFIX="webordinary.com" \
        -e CLAUDE_CODE_NON_INTERACTIVE="true" \
        -e CLAUDE_CODE_USE_BEDROCK="1" \
        -e NODE_ENV="production" \
        -e LOG_LEVEL="debug" \
        -v "$(pwd)/workspace:/workspace" \
        -v "$HOME/.aws:/home/appuser/.aws:ro" \
        webordinary/claude-code-test:latest
    
    print_info "Container started: claude-e2e-test"
}

# Monitor container logs
monitor_logs() {
    print_info "Monitoring container logs for 30 seconds..."
    timeout 30 docker logs -f claude-e2e-test || true
}

# Check results
check_results() {
    print_info "Checking S3 for deployed content..."
    AWS_PROFILE=personal aws s3 ls "s3://edit.amelia.webordinary.com/thread-$THREAD_ID/" || true
    
    print_info "Checking DynamoDB for thread mapping..."
    AWS_PROFILE=personal aws dynamodb get-item \
        --table-name webordinary-thread-mappings \
        --key "{\"threadId\": {\"S\": \"$THREAD_ID\"}}" \
        --output json || true
}

# Cleanup
cleanup() {
    print_info "Cleaning up..."
    docker stop claude-e2e-test 2>/dev/null || true
    docker rm claude-e2e-test 2>/dev/null || true
}

# Main execution
main() {
    trap cleanup EXIT
    
    print_info "Starting E2E test with SQS message..."
    print_info "Project: $PROJECT_ID, User: $USER_ID, Thread: $THREAD_ID"
    
    # Start container
    start_container
    
    # Wait for container to be ready
    sleep 5
    
    # Send message
    send_message
    
    # Monitor logs
    monitor_logs
    
    # Check results
    check_results
    
    print_info "Test completed!"
}

main "$@"