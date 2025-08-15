#!/bin/bash
# Check status of hybrid development environment

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 Hybrid Development Status${NC}"
echo "=================================================="

# Check Hermes container
echo -e "\n${YELLOW}Hermes (Docker):${NC}"
if docker ps --filter "name=hermes-manual" --format "table {{.Names}}\t{{.Status}}" | grep -q hermes-manual; then
    docker ps --filter "name=hermes-manual" --format "table {{.Names}}\t{{.Status}}"
    echo -e "${GREEN}✓ Hermes is running${NC}"
else
    echo -e "${RED}❌ Hermes is not running${NC}"
fi

# Check Claude process
echo -e "\n${YELLOW}Claude Code Container (Local):${NC}"
if [ -f /tmp/claude-local.pid ]; then
    CLAUDE_PID=$(cat /tmp/claude-local.pid)
    if ps -p $CLAUDE_PID > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Claude is running (PID: $CLAUDE_PID)${NC}"
        
        # Show process info
        ps -p $CLAUDE_PID -o pid,ppid,%cpu,%mem,etime,command | head -2
    else
        echo -e "${RED}❌ Claude is not running (PID file exists but process is dead)${NC}"
    fi
else
    echo -e "${RED}❌ Claude PID file not found${NC}"
fi

# Check logs
LOG_DIR="/tmp/webordinary-logs"
CLAUDE_LOG="$LOG_DIR/claude-output.log"

echo -e "\n${YELLOW}Logs:${NC}"
if [ -f "$CLAUDE_LOG" ]; then
    echo "Claude log: $CLAUDE_LOG"
    echo "Last 5 lines:"
    tail -5 "$CLAUDE_LOG" | sed 's/^/  /'
else
    echo -e "${RED}Claude log not found${NC}"
fi

echo ""
echo "Hermes logs (last 5 lines):"
docker logs hermes-manual 2>&1 | tail -5 | sed 's/^/  /'

# Check SQS queues if AWS is configured
if aws sts get-caller-identity --profile personal &> /dev/null; then
    echo -e "\n${YELLOW}SQS Queue Status:${NC}"
    
    # Get queue URLs from environment or use defaults
    EMAIL_QUEUE_URL="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-queue"
    UNCLAIMED_QUEUE_URL="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed-queue"
    
    # Check email queue
    EMAIL_COUNT=$(AWS_PROFILE=personal aws sqs get-queue-attributes \
        --queue-url "$EMAIL_QUEUE_URL" \
        --attribute-names ApproximateNumberOfMessages \
        --query 'Attributes.ApproximateNumberOfMessages' \
        --output text 2>/dev/null || echo "?")
    
    # Check unclaimed queue
    UNCLAIMED_COUNT=$(AWS_PROFILE=personal aws sqs get-queue-attributes \
        --queue-url "$UNCLAIMED_QUEUE_URL" \
        --attribute-names ApproximateNumberOfMessages \
        --query 'Attributes.ApproximateNumberOfMessages' \
        --output text 2>/dev/null || echo "?")
    
    echo "  Email queue messages: $EMAIL_COUNT"
    echo "  Unclaimed queue messages: $UNCLAIMED_COUNT"
fi

echo -e "\n${YELLOW}Commands:${NC}"
echo "  • Monitor Claude:  tail -f $CLAUDE_LOG"
echo "  • Monitor Hermes:  docker logs -f hermes-manual"
echo "  • Send test email: ./scripts/send-test-email.sh"
echo "  • Stop services:   ./scripts/stop-hybrid-dev.sh"