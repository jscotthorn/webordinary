#!/bin/bash
# Enhanced health check script for SQS-based container with Bedrock support
# Returns 0 if healthy, 1 if unhealthy

HEALTH_STATUS=0
HEALTH_MESSAGES=""

# Function to add health message
add_health_message() {
    HEALTH_MESSAGES="$HEALTH_MESSAGES\n  $1"
}

echo "Container Health Check"
echo "===================="

# 1. Check if main process is running (PID 1 in container)
if [ -d "/proc/1" ] && [ -f "/proc/1/cmdline" ]; then
    add_health_message "✓ Main process running"
else
    add_health_message "✗ Main process not running"
    HEALTH_STATUS=1
fi

# 2. Check AWS connectivity (only if AWS credentials configured)
if [ -n "$AWS_REGION" ]; then
    if aws sts get-caller-identity > /dev/null 2>&1; then
        add_health_message "✓ AWS credentials valid"
    else
        add_health_message "⚠ AWS credentials not available (may be using IAM role)"
    fi
fi

# 3. Check Bedrock connectivity (if enabled)
if [ "$CLAUDE_CODE_USE_BEDROCK" = "1" ]; then
    REGION=${AWS_REGION:-us-west-2}
    if aws bedrock list-foundation-models --region $REGION --max-results 1 > /dev/null 2>&1; then
        add_health_message "✓ Bedrock connectivity verified"
    else
        add_health_message "⚠ Bedrock not accessible (will use simulation mode)"
        # Don't fail health check - container can work in simulation mode
    fi
else
    add_health_message "ℹ Bedrock not enabled (simulation mode)"
fi

# 4. Check SQS connectivity (if queues configured)
if [ -n "$INPUT_QUEUE_URL" ] || [ -n "$UNCLAIMED_QUEUE_URL" ]; then
    QUEUE_URL=${INPUT_QUEUE_URL:-$UNCLAIMED_QUEUE_URL}
    if aws sqs get-queue-attributes --queue-url "$QUEUE_URL" --attribute-names QueueArn > /dev/null 2>&1; then
        add_health_message "✓ SQS queue accessible"
    else
        add_health_message "⚠ SQS queue not accessible"
        # Don't fail for local development
    fi
fi

# 5. Check workspace mount
if [ -d "$WORKSPACE_PATH" ]; then
    add_health_message "✓ Workspace mounted at $WORKSPACE_PATH"
else
    add_health_message "⚠ Workspace not mounted (expected at $WORKSPACE_PATH)"
fi

# 6. Check Node.js process
if pgrep -f "node" > /dev/null 2>&1; then
    add_health_message "✓ Node.js process running"
else
    add_health_message "⚠ Node.js process not found"
fi

# Print health status
echo -e "$HEALTH_MESSAGES"
echo ""

if [ $HEALTH_STATUS -eq 0 ]; then
    echo "Overall: HEALTHY"
else
    echo "Overall: UNHEALTHY"
fi

exit $HEALTH_STATUS