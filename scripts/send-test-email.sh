#!/bin/bash
# Send a test email message to the SQS queue
# This simulates an email received by SES

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
QUEUE_URL="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-queue"
PROFILE="personal"

echo -e "${YELLOW}Sending test email to SQS queue...${NC}"

# Use the sample SES message format
MESSAGE_FILE="hermes/test/fixtures/sample-ses-message.json"

if [ ! -f "$MESSAGE_FILE" ]; then
    echo "Error: Sample message file not found at $MESSAGE_FILE"
    exit 1
fi

# Send the message
MSG_ID=$(aws sqs send-message \
    --queue-url "$QUEUE_URL" \
    --message-body file://"$MESSAGE_FILE" \
    --profile "$PROFILE" \
    --query 'MessageId' \
    --output text)

if [ -n "$MSG_ID" ]; then
    echo -e "${GREEN}✅ Test email sent successfully${NC}"
    echo "Message ID: $MSG_ID"
    echo ""
    echo "Monitor the logs with:"
    echo "  docker compose -f docker-compose.local.yml logs -f"
else
    echo "Failed to send message"
    exit 1
fi