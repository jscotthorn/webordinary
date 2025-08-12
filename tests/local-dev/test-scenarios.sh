#!/bin/bash
# Local Development Test Scenarios
# Run these tests to verify your local development environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
QUEUE_URL="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-queue"
S3_BUCKET="edit.amelia.webordinary.com"
HERMES_HEALTH="http://localhost:3000/hermes/health"

echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}     WebOrdinary Local Development Test Suite${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""

# Test 1: Prerequisites Check
test_prerequisites() {
    echo -e "${YELLOW}Test 1: Prerequisites Check${NC}"
    echo "----------------------------"
    
    local passed=true
    
    # Check Docker
    if command -v docker &> /dev/null; then
        echo -e "  ✓ Docker installed"
    else
        echo -e "  ${RED}✗ Docker not installed${NC}"
        passed=false
    fi
    
    # Check AWS CLI
    if command -v aws &> /dev/null; then
        echo -e "  ✓ AWS CLI installed"
    else
        echo -e "  ${RED}✗ AWS CLI not installed${NC}"
        passed=false
    fi
    
    # Check AWS credentials
    if aws sts get-caller-identity --profile personal &> /dev/null; then
        ACCOUNT_ID=$(aws sts get-caller-identity --profile personal --query Account --output text)
        echo -e "  ✓ AWS credentials configured (Account: $ACCOUNT_ID)"
    else
        echo -e "  ${RED}✗ AWS credentials not configured${NC}"
        passed=false
    fi
    
    # Check Docker Compose
    if docker compose version &> /dev/null; then
        echo -e "  ✓ Docker Compose available"
    else
        echo -e "  ${RED}✗ Docker Compose not available${NC}"
        passed=false
    fi
    
    if [ "$passed" = true ]; then
        echo -e "${GREEN}✅ Test 1 PASSED${NC}\n"
        return 0
    else
        echo -e "${RED}❌ Test 1 FAILED${NC}\n"
        return 1
    fi
}

# Test 2: Container Health
test_container_health() {
    echo -e "${YELLOW}Test 2: Container Health Check${NC}"
    echo "--------------------------------"
    
    # Check if containers are running
    if docker compose -f docker-compose.local.yml ps --services --filter "status=running" | grep -q "hermes"; then
        echo -e "  ✓ Hermes container running"
    else
        echo -e "  ${RED}✗ Hermes container not running${NC}"
        echo -e "${RED}❌ Test 2 FAILED${NC}\n"
        return 1
    fi
    
    if docker compose -f docker-compose.local.yml ps --services --filter "status=running" | grep -q "claude-container"; then
        echo -e "  ✓ Claude container running"
    else
        echo -e "  ${RED}✗ Claude container not running${NC}"
        echo -e "${RED}❌ Test 2 FAILED${NC}\n"
        return 1
    fi
    
    # Check Hermes health endpoint
    if curl -s -f "$HERMES_HEALTH" > /dev/null 2>&1; then
        echo -e "  ✓ Hermes health endpoint responding"
    else
        echo -e "  ${RED}✗ Hermes health endpoint not responding${NC}"
        echo -e "${RED}❌ Test 2 FAILED${NC}\n"
        return 1
    fi
    
    echo -e "${GREEN}✅ Test 2 PASSED${NC}\n"
    return 0
}

# Test 3: AWS Service Connectivity
test_aws_connectivity() {
    echo -e "${YELLOW}Test 3: AWS Service Connectivity${NC}"
    echo "----------------------------------"
    
    local passed=true
    
    # Check SQS access
    if aws sqs get-queue-attributes \
        --queue-url "$QUEUE_URL" \
        --attribute-names QueueArn \
        --profile personal &> /dev/null; then
        echo -e "  ✓ SQS queue accessible"
    else
        echo -e "  ${RED}✗ Cannot access SQS queue${NC}"
        passed=false
    fi
    
    # Check DynamoDB tables
    tables=("webordinary-queue-tracking" "webordinary-thread-mappings" "webordinary-edit-sessions")
    for table in "${tables[@]}"; do
        if aws dynamodb describe-table \
            --table-name "$table" \
            --profile personal &> /dev/null; then
            echo -e "  ✓ DynamoDB table '$table' accessible"
        else
            echo -e "  ${RED}✗ Cannot access DynamoDB table '$table'${NC}"
            passed=false
        fi
    done
    
    # Check S3 bucket
    if aws s3 ls "s3://$S3_BUCKET" --profile personal &> /dev/null; then
        echo -e "  ✓ S3 bucket accessible"
    else
        echo -e "  ${RED}✗ Cannot access S3 bucket${NC}"
        passed=false
    fi
    
    if [ "$passed" = true ]; then
        echo -e "${GREEN}✅ Test 3 PASSED${NC}\n"
        return 0
    else
        echo -e "${RED}❌ Test 3 FAILED${NC}\n"
        return 1
    fi
}

# Test 4: Bedrock Integration (Optional)
test_bedrock() {
    echo -e "${YELLOW}Test 4: Bedrock Integration (Optional)${NC}"
    echo "---------------------------------------"
    
    # Check if Bedrock is enabled
    if [ "$CLAUDE_CODE_USE_BEDROCK" != "1" ]; then
        echo -e "  ⚠️  Bedrock not enabled (simulation mode)"
        echo -e "${YELLOW}⚡ Test 4 SKIPPED${NC}\n"
        return 0
    fi
    
    # List available models
    if aws bedrock list-foundation-models \
        --region us-west-2 \
        --profile personal \
        --query 'modelSummaries[?contains(modelId, `claude`)]' &> /dev/null; then
        echo -e "  ✓ Bedrock API accessible"
        
        # Test model invocation with minimal request
        if echo '{"anthropic_version":"bedrock-2023-05-31","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}' | \
           aws bedrock-runtime invoke-model \
            --model-id anthropic.claude-3-5-haiku-20241022-v1:0 \
            --region us-west-2 \
            --profile personal \
            --content-type application/json \
            --body file:///dev/stdin \
            /tmp/bedrock-test.json &> /dev/null; then
            echo -e "  ✓ Model invocation successful"
            rm -f /tmp/bedrock-test.json
        else
            echo -e "  ${RED}✗ Model invocation failed${NC}"
            echo -e "${RED}❌ Test 4 FAILED${NC}\n"
            return 1
        fi
    else
        echo -e "  ${RED}✗ Cannot access Bedrock${NC}"
        echo -e "${RED}❌ Test 4 FAILED${NC}\n"
        return 1
    fi
    
    echo -e "${GREEN}✅ Test 4 PASSED${NC}\n"
    return 0
}

# Test 5: Message Flow
test_message_flow() {
    echo -e "${YELLOW}Test 5: End-to-End Message Flow${NC}"
    echo "---------------------------------"
    
    # Create test message
    TEST_MSG=$(cat <<EOF
{
  "from": "test@local.dev",
  "subject": "Test $(date +%s)",
  "body": "Local development test message"
}
EOF
)
    
    echo -e "  📤 Sending test message to SQS..."
    
    # Send message
    MSG_ID=$(aws sqs send-message \
        --queue-url "$QUEUE_URL" \
        --message-body "$TEST_MSG" \
        --profile personal \
        --query 'MessageId' \
        --output text)
    
    if [ -n "$MSG_ID" ]; then
        echo -e "  ✓ Message sent (ID: ${MSG_ID:0:8}...)"
    else
        echo -e "  ${RED}✗ Failed to send message${NC}"
        echo -e "${RED}❌ Test 5 FAILED${NC}\n"
        return 1
    fi
    
    echo -e "  ⏳ Waiting for processing (10 seconds)..."
    sleep 10
    
    # Check if message was consumed (queue should be empty or have fewer messages)
    QUEUE_DEPTH=$(aws sqs get-queue-attributes \
        --queue-url "$QUEUE_URL" \
        --attribute-names ApproximateNumberOfMessages \
        --profile personal \
        --query 'Attributes.ApproximateNumberOfMessages' \
        --output text)
    
    echo -e "  📊 Queue depth: $QUEUE_DEPTH messages"
    
    # Check recent logs for processing
    if docker compose -f docker-compose.local.yml logs hermes --tail 50 | grep -q "Processing message"; then
        echo -e "  ✓ Message processing detected in logs"
    else
        echo -e "  ⚠️  No processing activity in recent logs"
    fi
    
    echo -e "${GREEN}✅ Test 5 PASSED${NC}\n"
    return 0
}

# Test 6: S3 Deployment
test_s3_deployment() {
    echo -e "${YELLOW}Test 6: S3 Deployment Check${NC}"
    echo "-----------------------------"
    
    # Check if S3 bucket has content
    FILE_COUNT=$(aws s3 ls "s3://$S3_BUCKET/" --recursive --profile personal | wc -l)
    
    if [ "$FILE_COUNT" -gt 0 ]; then
        echo -e "  ✓ S3 bucket contains $FILE_COUNT files"
        
        # Check for recent modifications
        RECENT=$(aws s3 ls "s3://$S3_BUCKET/" --recursive --profile personal | head -5)
        echo -e "  📁 Recent files:"
        echo "$RECENT" | while read line; do
            echo "     $line"
        done
    else
        echo -e "  ⚠️  S3 bucket is empty (no deployments yet)"
    fi
    
    echo -e "${GREEN}✅ Test 6 PASSED${NC}\n"
    return 0
}

# Main test runner
main() {
    local total_tests=0
    local passed_tests=0
    local failed_tests=0
    local skipped_tests=0
    
    # Run tests
    tests=(
        "test_prerequisites"
        "test_container_health"
        "test_aws_connectivity"
        "test_bedrock"
        "test_message_flow"
        "test_s3_deployment"
    )
    
    for test in "${tests[@]}"; do
        total_tests=$((total_tests + 1))
        if $test; then
            passed_tests=$((passed_tests + 1))
        else
            failed_tests=$((failed_tests + 1))
        fi
    done
    
    # Summary
    echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}                  Test Summary${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  Total Tests:    $total_tests"
    echo -e "  ${GREEN}Passed:         $passed_tests${NC}"
    echo -e "  ${RED}Failed:         $failed_tests${NC}"
    echo ""
    
    if [ "$failed_tests" -eq 0 ]; then
        echo -e "${GREEN}🎉 All tests passed! Your local development environment is ready.${NC}"
        exit 0
    else
        echo -e "${RED}⚠️  Some tests failed. Please check the output above.${NC}"
        exit 1
    fi
}

# Check if we're in the right directory
if [ ! -f "docker-compose.local.yml" ]; then
    echo -e "${RED}Error: docker-compose.local.yml not found${NC}"
    echo "Please run this script from the project root directory"
    exit 1
fi

# Run main
main