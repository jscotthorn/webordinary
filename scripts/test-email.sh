#!/bin/bash
# Test email processing through the full Lambda/Step Functions pipeline

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Parse arguments
EMAIL_TYPE="simple"
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --with-attachment)
            EMAIL_TYPE="attachment"
            shift
            ;;
        --interrupt)
            EMAIL_TYPE="interrupt"
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  --with-attachment  Include a mock attachment"
            echo "  --interrupt        Simulate an interrupt scenario"
            echo "  --verbose          Show detailed output"
            echo "  --help             Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "${CYAN}📧 Testing Email Processing Pipeline${NC}"
echo "════════════════════════════════════"

# Check if LocalStack is running
if ! docker ps | grep -q localstack-main; then
    echo -e "${RED}❌ LocalStack is not running${NC}"
    echo "Please run: ./scripts/start-local.sh"
    exit 1
fi

# Create test email based on type
TIMESTAMP=$(date +%s)
EMAIL_FILE="/tmp/test-email-${TIMESTAMP}.txt"

case $EMAIL_TYPE in
    "simple")
        echo -e "${YELLOW}Creating simple test email...${NC}"
        cat > "${EMAIL_FILE}" << 'EOF'
From: test@example.com
To: scott@amelia.webordinary.com
Subject: Test Email for Lambda Processing
Message-ID: <test-message-id@example.com>
Date: Thu, 1 Jan 2025 12:00:00 +0000
Content-Type: text/plain; charset=UTF-8

This is a test email for the Lambda processing pipeline.

Please update the homepage with a new hero section featuring our latest products.

Thanks!
EOF
        ;;
        
    "attachment")
        echo -e "${YELLOW}Creating email with attachment...${NC}"
        cat > "${EMAIL_FILE}" << 'EOF'
From: designer@example.com
To: scott@amelia.webordinary.com
Subject: [thread-design-123] New Hero Image
Message-ID: <attachment-test@example.com>
Date: Thu, 1 Jan 2025 12:00:00 +0000
Content-Type: multipart/mixed; boundary="boundary123"

--boundary123
Content-Type: text/plain; charset=UTF-8

Hi Scott,

Here's the new hero image for the homepage. Please add it to the site.

Best,
Designer

--boundary123
Content-Type: image/jpeg; name="hero-image.jpg"
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="hero-image.jpg"

/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a
HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy
MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA
AhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEB
AQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX
/9k=

--boundary123--
EOF
        ;;
        
    "interrupt")
        echo -e "${YELLOW}Creating interrupt scenario email...${NC}"
        # First, create an active job
        AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
        aws --endpoint-url=http://localhost:4566 dynamodb put-item \
            --table-name webordinary-active-jobs \
            --item '{"projectUserId": {"S": "amelia#scott"}, "containerId": {"S": "test-container-123"}, "threadId": {"S": "thread-old-123"}}' \
            2>/dev/null || true
        
        cat > "${EMAIL_FILE}" << 'EOF'
From: urgent@example.com
To: scott@amelia.webordinary.com
Subject: [URGENT] Interrupt Previous Task
Message-ID: <interrupt-test@example.com>
Date: Thu, 1 Jan 2025 12:00:00 +0000
Content-Type: text/plain; charset=UTF-8

This is an urgent email that should interrupt the previous task.

Please stop what you're doing and handle this immediately!
EOF
        ;;
esac

# Upload email to S3
echo -e "${YELLOW}▶ Uploading email to S3...${NC}"
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
aws --endpoint-url=http://localhost:4566 \
    s3 cp "${EMAIL_FILE}" \
    s3://webordinary-ses-emails/emails/test-email-${TIMESTAMP}.txt \
    --metadata "timestamp=${TIMESTAMP}" \
    >/dev/null

echo -e "${GREEN}✓ Email uploaded${NC}"

# Wait for processing
echo -e "${YELLOW}▶ Waiting for processing...${NC}"
sleep 3

# Check Step Functions execution
echo -e "\n${BLUE}═══ Step Functions Status ═══${NC}"
EXECUTIONS=$(AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
aws --endpoint-url=http://localhost:4566 \
    stepfunctions list-executions \
    --state-machine-arn arn:aws:states:us-east-1:000000000000:stateMachine:email-processor \
    --max-items 1 \
    2>/dev/null || echo "{}")

if echo "$EXECUTIONS" | grep -q "executionArn"; then
    LATEST_EXECUTION=$(echo "$EXECUTIONS" | grep -o '"executionArn": "[^"]*"' | head -1 | cut -d'"' -f4)
    STATUS=$(AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
    aws --endpoint-url=http://localhost:4566 \
        stepfunctions describe-execution \
        --execution-arn "$LATEST_EXECUTION" \
        --query 'status' \
        --output text 2>/dev/null || echo "UNKNOWN")
    
    echo "Latest execution: $STATUS"
    
    if [ "$VERBOSE" = true ]; then
        echo -e "\n${YELLOW}Execution details:${NC}"
        AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
        aws --endpoint-url=http://localhost:4566 \
            stepfunctions describe-execution \
            --execution-arn "$LATEST_EXECUTION" \
            2>/dev/null | jq '.' || true
    fi
else
    echo "No Step Functions executions found (Lambda may have processed directly)"
fi

# Check Lambda logs
if [ "$VERBOSE" = true ]; then
    echo -e "\n${BLUE}═══ Lambda Logs ═══${NC}"
    docker logs localstack-main 2>&1 | grep -A5 "intake-lambda" | tail -20 || echo "No recent Lambda logs"
fi

# Check SQS queues
echo -e "\n${BLUE}═══ Queue Status ═══${NC}"
for queue in webordinary-input-amelia-scott.fifo webordinary-interrupts-amelia-scott webordinary-dlq-amelia-scott; do
    COUNT=$(AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
        aws --endpoint-url=http://localhost:4566 \
        sqs get-queue-attributes \
        --queue-url http://localhost:4566/000000000000/${queue} \
        --attribute-names ApproximateNumberOfMessages \
        --query 'Attributes.ApproximateNumberOfMessages' \
        --output text 2>/dev/null || echo "0")
    
    # Format queue name for display
    QUEUE_DISPLAY=$(echo $queue | sed 's/webordinary-//' | sed 's/-amelia-scott//' | sed 's/.fifo//')
    printf "  %-15s : %s messages\n" "$QUEUE_DISPLAY" "$COUNT"
done

# Check for active jobs (if testing interrupt)
if [ "$EMAIL_TYPE" = "interrupt" ]; then
    echo -e "\n${BLUE}═══ Active Jobs ═══${NC}"
    ACTIVE_JOB=$(AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
    aws --endpoint-url=http://localhost:4566 \
        dynamodb get-item \
        --table-name webordinary-active-jobs \
        --key '{"projectUserId": {"S": "amelia#scott"}}' \
        2>/dev/null || echo "{}")
    
    if echo "$ACTIVE_JOB" | grep -q "Item"; then
        echo "Active job found:"
        echo "$ACTIVE_JOB" | jq '.Item' 2>/dev/null || echo "$ACTIVE_JOB"
    else
        echo "No active job (interrupt may have cleared it)"
    fi
fi

# Cleanup
rm "${EMAIL_FILE}"

echo ""
echo -e "${GREEN}✅ Test completed${NC}"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo "  • Monitor LocalStack: docker logs -f localstack-main"
echo "  • Check S3 output:    AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test aws --endpoint-url=http://localhost:4566 s3 ls s3://edit.amelia.webordinary.com/"
if [ -f /tmp/claude-local.pid ]; then
    echo "  • Claude logs:        tail -f /tmp/webordinary-logs/claude-output.log"
fi