#!/bin/bash
# Check status of local development environment

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}🔍 WebOrdinary Local Development Status${NC}"
echo "=================================================="

# Check Docker containers
echo -e "\n${YELLOW}Docker Containers:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.State}}" | grep -E "hermes|claude" || echo "No containers running"

# Check recent processing
echo -e "\n${YELLOW}Recent Activity:${NC}"

# Check Claude logs for recent claims
echo -e "${CYAN}Claude Container:${NC}"
if docker ps | grep -q claude-manual; then
    CLAIM=$(docker logs claude-manual 2>&1 | grep "Successfully claimed" | tail -1)
    COMMIT=$(docker logs claude-manual 2>&1 | grep "Committed:" | tail -1)
    PUSH=$(docker logs claude-manual 2>&1 | grep "Pushed branch" | tail -1)
    
    if [ -n "$CLAIM" ]; then
        echo "  ✓ $CLAIM"
    else
        echo "  ⚠ No claims yet"
    fi
    
    if [ -n "$COMMIT" ]; then
        echo "  ✓ Last commit: ${COMMIT:50:50}..."
    else
        echo "  ⚠ No commits yet"
    fi
    
    if [ -n "$PUSH" ]; then
        echo "  ✓ $PUSH"
    else
        echo "  ⚠ No pushes yet"
    fi
else
    echo "  ❌ Container not running"
fi

# Check Hermes
echo -e "\n${CYAN}Hermes:${NC}"
if docker ps | grep -q hermes-manual; then
    ROUTED=$(docker logs hermes-manual 2>&1 | grep "Successfully routed to project queue" | tail -1)
    if [ -n "$ROUTED" ]; then
        echo "  ✓ $ROUTED"
    else
        echo "  ⚠ No messages routed yet"
    fi
else
    echo "  ❌ Container not running"
fi

# Check GitHub branches
echo -e "\n${YELLOW}Recent GitHub Branches:${NC}"
git ls-remote https://github.com/jscotthorn/amelia-astro.git 2>/dev/null | grep thread | tail -3 | while read hash ref; do
    branch=$(echo $ref | sed 's|refs/heads/||')
    echo "  • $branch (${hash:0:7})"
done || echo "  ❌ Could not fetch branches"

# Check AWS resources
echo -e "\n${YELLOW}AWS Resources (profile: personal):${NC}"
if aws sts get-caller-identity --profile personal &> /dev/null; then
    # Check SQS queue depth
    QUEUE_DEPTH=$(aws sqs get-queue-attributes \
        --queue-url https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed \
        --attribute-names ApproximateNumberOfMessages \
        --profile personal \
        --output text \
        --query 'Attributes.ApproximateNumberOfMessages' 2>/dev/null)
    echo "  • Unclaimed queue messages: ${QUEUE_DEPTH:-0}"
    
    # Check recent container ownership
    OWNER=$(aws dynamodb scan \
        --table-name webordinary-container-ownership \
        --limit 1 \
        --profile personal \
        --output text \
        --query 'Items[0].projectKey.S' 2>/dev/null)
    if [ -n "$OWNER" ]; then
        echo "  • Active claim: $OWNER"
    else
        echo "  • No active claims"
    fi
else
    echo "  ❌ AWS credentials not configured"
fi

echo -e "\n${GREEN}Commands:${NC}"
echo "  • Send test: ./scripts/send-test-email.sh"
echo "  • View logs: docker logs -f claude-manual"
echo "  • Restart: ./scripts/start-local-dev-manual.sh"
echo "  • Stop: docker stop hermes-manual claude-manual"