#!/bin/bash

# Complete E2E test with proper message flow
set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }
print_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Configuration
PROJECT_ID="amelia"
USER_ID="test-user-$(date +%s)"
THREAD_ID="test-thread-$(date +%s)"
MESSAGE_ID="msg-$(date +%s)"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Queue URLs
UNCLAIMED_QUEUE="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed"
# Create or use existing FIFO queue for this project+user
PROJECT_QUEUE="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-input-${PROJECT_ID}-${USER_ID}.fifo"

print_info "Starting complete E2E test"
print_info "Project: $PROJECT_ID, User: $USER_ID, Thread: $THREAD_ID"

# Step 1: Start container
start_container() {
    print_info "Starting claude-code-container in Docker..."
    
    cd /Users/scott/Projects/webordinary/claude-code-container
    
    # Stop any existing container
    docker stop claude-e2e-complete 2>/dev/null || true
    docker rm claude-e2e-complete 2>/dev/null || true
    
    # Start new container
    docker run -d \
        --name claude-e2e-complete \
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
    
    print_info "Container started"
    sleep 5
}

# Step 2: Create FIFO queue if it doesn't exist
create_fifo_queue() {
    print_info "Checking/creating FIFO queue for project+user..."
    
    local queue_name="webordinary-input-${PROJECT_ID}-${USER_ID}.fifo"
    
    # Check if queue exists
    if AWS_PROFILE=personal aws sqs get-queue-url --queue-name "$queue_name" 2>/dev/null; then
        print_info "Queue already exists: $queue_name"
        PROJECT_QUEUE=$(AWS_PROFILE=personal aws sqs get-queue-url --queue-name "$queue_name" --query 'QueueUrl' --output text)
    else
        print_info "Creating new FIFO queue: $queue_name"
        PROJECT_QUEUE=$(AWS_PROFILE=personal aws sqs create-queue \
            --queue-name "$queue_name" \
            --attributes '{
                "FifoQueue":"true",
                "ContentBasedDeduplication":"true",
                "MessageRetentionPeriod":"3600",
                "VisibilityTimeout":"300"
            }' \
            --query 'QueueUrl' \
            --output text)
    fi
    
    print_info "Project queue URL: $PROJECT_QUEUE"
}

# Step 3: Send CLAIM_REQUEST to unclaimed queue
send_claim_request() {
    print_info "Sending CLAIM_REQUEST to unclaimed queue..."
    
    local claim_message=$(cat <<EOF
{
  "type": "CLAIM_REQUEST",
  "projectId": "$PROJECT_ID",
  "userId": "$USER_ID",
  "threadId": "$THREAD_ID",
  "messageId": "$MESSAGE_ID",
  "queueUrl": "$PROJECT_QUEUE",
  "timestamp": "$TIMESTAMP"
}
EOF
)
    
    print_info "Claim message: $claim_message"
    
    AWS_PROFILE=personal aws sqs send-message \
        --queue-url "$UNCLAIMED_QUEUE" \
        --message-body "$claim_message" \
        --output json
    
    print_info "CLAIM_REQUEST sent, waiting for container to claim..."
    sleep 5
}

# Step 4: Send actual work message to project queue
send_work_message() {
    print_info "Sending work message to project FIFO queue..."
    
    # Create work message with Step Functions task token
    local work_message=$(cat <<EOF
{
  "projectId": "$PROJECT_ID",
  "userId": "$USER_ID",
  "threadId": "$THREAD_ID",
  "messageId": "work-$MESSAGE_ID",
  "content": "Create a simple Astro site with an index page that says 'Hello from E2E Test - Thread $THREAD_ID'. Add the current timestamp to the page.",
  "timestamp": "$TIMESTAMP",
  "repoUrl": "https://github.com/jscotthorn/amelia-astro.git",
  "branch": "thread-$THREAD_ID",
  "taskToken": "test-token-$(date +%s)",
  "email": {
    "from": "test@example.com",
    "subject": "E2E Test Message",
    "text": "Create a simple test page"
  }
}
EOF
)
    
    print_info "Work message: $work_message"
    
    # Send to FIFO queue with deduplication ID and group ID
    AWS_PROFILE=personal aws sqs send-message \
        --queue-url "$PROJECT_QUEUE" \
        --message-body "$work_message" \
        --message-deduplication-id "$MESSAGE_ID" \
        --message-group-id "${PROJECT_ID}-${USER_ID}" \
        --output json
    
    print_info "Work message sent to project queue"
}

# Step 5: Monitor container logs
monitor_container() {
    print_info "Monitoring container for 60 seconds..."
    
    # Follow logs for a period
    timeout 60 docker logs -f claude-e2e-complete 2>&1 | while read -r line; do
        echo "$line"
        
        # Check for success indicators
        if echo "$line" | grep -q "Successfully pushed to branch"; then
            print_info "✅ Container pushed to GitHub!"
        fi
        
        if echo "$line" | grep -q "Deployed to S3"; then
            print_info "✅ Container deployed to S3!"
        fi
    done || true
}

# Step 6: Verify results
verify_results() {
    print_info "Verifying results..."
    
    # Check if branch was created on GitHub
    print_info "Checking GitHub for branch thread-$THREAD_ID..."
    if git ls-remote --heads origin "thread-$THREAD_ID" 2>/dev/null | grep -q "thread-$THREAD_ID"; then
        print_info "✅ Branch thread-$THREAD_ID exists on GitHub!"
    else
        print_warn "⚠️ Branch thread-$THREAD_ID not found on GitHub"
    fi
    
    # Check S3 deployment
    print_info "Checking S3 deployment..."
    if AWS_PROFILE=personal aws s3 ls "s3://edit.amelia.webordinary.com/thread-$THREAD_ID/" 2>/dev/null; then
        print_info "✅ Files deployed to S3!"
        AWS_PROFILE=personal aws s3 ls "s3://edit.amelia.webordinary.com/thread-$THREAD_ID/" --recursive
    else
        print_warn "⚠️ No S3 deployment found"
    fi
    
    # Check DynamoDB thread mapping
    print_info "Checking DynamoDB thread mapping..."
    AWS_PROFILE=personal aws dynamodb get-item \
        --table-name webordinary-thread-mappings \
        --key "{\"threadId\": {\"S\": \"$THREAD_ID\"}}" \
        --output json 2>/dev/null || print_warn "No thread mapping found"
    
    # Check container ownership
    print_info "Checking container ownership..."
    AWS_PROFILE=personal aws dynamodb query \
        --table-name webordinary-container-ownership \
        --key-condition-expression "projectKey = :pk" \
        --expression-attribute-values "{\":pk\":{\"S\":\"${PROJECT_ID}#${USER_ID}\"}}" \
        --output json 2>/dev/null || print_warn "No ownership record found"
}

# Cleanup
cleanup() {
    print_info "Cleaning up..."
    docker stop claude-e2e-complete 2>/dev/null || true
    docker rm claude-e2e-complete 2>/dev/null || true
    
    # Optionally delete test branch from GitHub
    if [ "${DELETE_BRANCH:-false}" = "true" ]; then
        print_info "Deleting test branch from GitHub..."
        git push origin --delete "thread-$THREAD_ID" 2>/dev/null || true
    fi
}

# Main execution
main() {
    trap cleanup EXIT
    
    print_info "=== Starting Complete E2E Test ==="
    print_info "This test will:"
    print_info "1. Start the container"
    print_info "2. Create/verify FIFO queue"
    print_info "3. Send CLAIM_REQUEST"
    print_info "4. Send work message"
    print_info "5. Monitor processing"
    print_info "6. Verify GitHub push and S3 deployment"
    echo ""
    
    # Execute steps
    start_container
    create_fifo_queue
    send_claim_request
    send_work_message
    monitor_container
    verify_results
    
    print_info "=== E2E Test Complete ==="
    print_info "Thread ID: $THREAD_ID"
    print_info "Check: https://github.com/jscotthorn/amelia-astro/tree/thread-$THREAD_ID"
    print_info "Site: https://edit.amelia.webordinary.com/thread-$THREAD_ID/"
}

# Run if not sourced
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi