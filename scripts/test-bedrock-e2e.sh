#!/bin/bash

# Test with explicit Bedrock configuration
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }
print_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Clean up any existing test container
docker stop claude-bedrock-test 2>/dev/null && docker rm claude-bedrock-test 2>/dev/null || true

# Load AWS credentials
export AWS_ACCESS_KEY_ID="$(aws configure get aws_access_key_id --profile personal)"
export AWS_SECRET_ACCESS_KEY="$(aws configure get aws_secret_access_key --profile personal)"

if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
    print_error "Failed to load AWS credentials from 'personal' profile"
    exit 1
fi

# Check GitHub token
if [ -z "${GITHUB_TOKEN:-}" ]; then
    print_error "GITHUB_TOKEN not set. Please export GITHUB_TOKEN with write permissions"
    exit 1
fi

# Start container with Bedrock explicitly enabled
print_info "Starting container with Bedrock enabled..."

docker run -d \
    --name claude-bedrock-test \
    --platform linux/amd64 \
    -e AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
    -e AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
    -e AWS_REGION="us-west-2" \
    -e AWS_ACCOUNT_ID="942734823970" \
    -e GITHUB_TOKEN="${GITHUB_TOKEN}" \
    -e CLAUDE_CODE_USE_BEDROCK="1" \
    -e WORKSPACE_PATH="/workspace" \
    -e UNCLAIMED_QUEUE_URL="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed" \
    -e OWNERSHIP_TABLE="webordinary-container-ownership" \
    -e ACTIVE_JOBS_TABLE="webordinary-active-jobs" \
    -e GIT_PUSH_ENABLED="true" \
    webordinary/claude-code-container:final-fix

print_info "Container started, waiting for initialization..."
sleep 5

# Option 1: Test with full E2E flow (email to S3)
if [ "${1:-}" == "--full" ]; then
    print_info "Testing full E2E flow with email..."
    
    # Send test email
    ./test-aws-email.sh
    
    print_info "Waiting for Step Functions to process..."
    sleep 5
    
    # Check Step Functions execution
    print_info "Checking Step Functions executions..."
    AWS_PROFILE=personal aws stepfunctions list-executions \
        --state-machine-arn arn:aws:states:us-west-2:942734823970:stateMachine:email-processor \
        --max-items 1 \
        --query 'executions[0].{Name:name,Status:status}' \
        --output table
    
else
    # Option 2: Direct test with manual message
    print_info "Testing with direct SQS message..."
    
    PROJECT_ID="amelia"
    USER_ID="scott"
    THREAD_ID="thread-bedrock-$(date +%s)"
    TIMESTAMP=$(date +%s)
    QUEUE_URL="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-input-${PROJECT_ID}-${USER_ID}.fifo"
    
    # Check if project queue exists, create if needed
    AWS_PROFILE=personal aws sqs get-queue-attributes \
        --queue-url "$QUEUE_URL" \
        --attribute-names QueueArn > /dev/null 2>&1 || {
        print_info "Creating FIFO queue..."
        AWS_PROFILE=personal aws sqs create-queue \
            --queue-name "webordinary-input-${PROJECT_ID}-${USER_ID}.fifo" \
            --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"true","MessageRetentionPeriod":"3600"}' || true
        sleep 2
    }
    
    print_info "Sending CLAIM_REQUEST to unclaimed queue..."
    AWS_PROFILE=personal aws sqs send-message \
        --queue-url "https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed" \
        --message-body "{
            \"type\": \"CLAIM_REQUEST\",
            \"projectId\": \"$PROJECT_ID\",
            \"userId\": \"$USER_ID\",
            \"threadId\": \"$THREAD_ID\",
            \"messageId\": \"claim-$TIMESTAMP\",
            \"queueUrl\": \"$QUEUE_URL\",
            \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
        }" > /dev/null
    
    sleep 3
    
    print_info "Sending work message with Step Functions format..."
    AWS_PROFILE=personal aws sqs send-message \
        --queue-url "$QUEUE_URL" \
        --message-body "{
            \"taskToken\": \"test-token-$TIMESTAMP\",
            \"messageId\": \"work-$TIMESTAMP\",
            \"projectId\": \"$PROJECT_ID\",
            \"userId\": \"$USER_ID\",
            \"threadId\": \"$THREAD_ID\",
            \"from\": \"test@example.com\",
            \"to\": [\"scott@amelia.webordinary.com\"],
            \"subject\": \"Test Bedrock E2E\",
            \"text\": \"Create a simple HTML file called bedrock-test.html with 'Bedrock Test Success' as the title and a paragraph saying 'This file was created by Claude via AWS Bedrock'\",
            \"attachments\": [],
            \"repoUrl\": \"https://github.com/jscotthorn/amelia-astro.git\",
            \"receivedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
        }" \
        --message-deduplication-id "$TIMESTAMP" \
        --message-group-id "${PROJECT_ID}#${USER_ID}" > /dev/null
    
    print_info "Message sent. Container should process it..."
fi

print_info "Monitoring logs for 30 seconds..."
timeout 30 docker logs -f claude-bedrock-test 2>&1 | while read -r line; do
    echo "$line"
    if echo "$line" | grep -q "Claude Code SDK execution failed"; then
        print_error "SDK execution failed!"
    fi
    if echo "$line" | grep -q "Claude Code session started"; then
        print_info "✅ Claude SDK started successfully!"
    fi
    if echo "$line" | grep -q "Pushed branch .* successfully"; then
        print_info "✅ Branch pushed to GitHub!"
    fi
    if echo "$line" | grep -q "S3 sync complete"; then
        print_info "✅ Deployed to S3!"
    fi
    if echo "$line" | grep -q "Task success sent to Step Functions"; then
        print_info "✅ Step Functions callback successful!"
    fi
done || true

print_info "Checking final status..."
docker logs claude-bedrock-test 2>&1 | tail -20 | grep -E "Pushed branch|S3 sync complete|Task success" || true

# Check if branch was created on GitHub
if [ "${1:-}" != "--full" ]; then
    print_info "Checking GitHub for new branches..."
    curl -s -H "Authorization: token ${GITHUB_TOKEN}" \
        "https://api.github.com/repos/jscotthorn/amelia-astro/branches?per_page=5" \
        | grep -E '"name"' | head -5 || true
fi

print_info "Cleanup..."
docker stop claude-bedrock-test > /dev/null 2>&1 && docker rm claude-bedrock-test > /dev/null 2>&1

print_info "Test complete!"