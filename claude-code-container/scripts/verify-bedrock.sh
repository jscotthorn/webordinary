#!/bin/bash
# Verify Bedrock access and configuration for Claude Code SDK

set -e

echo "🔍 Bedrock Configuration Verification Script"
echo "============================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check command success
check_status() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
        return 0
    else
        echo -e "${RED}✗${NC} $1"
        return 1
    fi
}

# 1. Check AWS credentials
echo -e "\n${YELLOW}1. Checking AWS credentials...${NC}"
if aws sts get-caller-identity --profile ${AWS_PROFILE:-personal} > /dev/null 2>&1; then
    ACCOUNT_ID=$(aws sts get-caller-identity --profile ${AWS_PROFILE:-personal} --query Account --output text)
    echo -e "${GREEN}✓${NC} AWS credentials valid (Account: $ACCOUNT_ID)"
else
    echo -e "${RED}✗${NC} AWS credentials not configured"
    echo "   Please run: aws configure --profile personal"
    exit 1
fi

# 2. Check Bedrock model access
echo -e "\n${YELLOW}2. Checking Bedrock model access...${NC}"
REGION=${AWS_REGION:-us-west-2}
echo "   Using region: $REGION"

# List available Claude models
if aws bedrock list-foundation-models --region $REGION --profile ${AWS_PROFILE:-personal} \
    --query 'modelSummaries[?contains(modelId, `claude`)].[modelId]' \
    --output text > /dev/null 2>&1; then
    
    MODEL_COUNT=$(aws bedrock list-foundation-models --region $REGION --profile ${AWS_PROFILE:-personal} \
        --query 'modelSummaries[?contains(modelId, `claude`)] | length(@)' --output text)
    echo -e "${GREEN}✓${NC} Bedrock access confirmed ($MODEL_COUNT Claude models available)"
else
    echo -e "${RED}✗${NC} Cannot access Bedrock models"
    echo "   Ensure your IAM user/role has bedrock:ListFoundationModels permission"
    exit 1
fi

# 3. Test model invocation capability
echo -e "\n${YELLOW}3. Testing model invocation...${NC}"

# Use Claude 3.5 Haiku for testing (fast and cheap)
TEST_MODEL="anthropic.claude-3-5-haiku-20241022-v1:0"

# Create a simple test prompt
cat > /tmp/bedrock-test-prompt.json <<EOF
{
    "anthropic_version": "bedrock-2023-05-31",
    "max_tokens": 100,
    "messages": [
        {
            "role": "user",
            "content": "Say 'Bedrock integration successful' and nothing else."
        }
    ]
}
EOF

# Try to invoke the model
if aws bedrock-runtime invoke-model \
    --model-id "$TEST_MODEL" \
    --region $REGION \
    --profile ${AWS_PROFILE:-personal} \
    --content-type "application/json" \
    --body file:///tmp/bedrock-test-prompt.json \
    /tmp/bedrock-response.json 2>/dev/null; then
    
    # Parse the response
    if [ -f /tmp/bedrock-response.json ]; then
        RESPONSE=$(python3 -c "import json; data=json.load(open('/tmp/bedrock-response.json')); print(data.get('content', [{}])[0].get('text', 'No response'))" 2>/dev/null || echo "Could not parse response")
        echo -e "${GREEN}✓${NC} Model invocation successful"
        echo "   Response: $RESPONSE"
    fi
else
    echo -e "${YELLOW}⚠${NC}  Model invocation failed (may need bedrock:InvokeModel permission)"
    echo "   This is optional for local development with simulation mode"
fi

# 4. Check Claude Code SDK environment variables
echo -e "\n${YELLOW}4. Checking Claude Code SDK configuration...${NC}"

if [ "$CLAUDE_CODE_USE_BEDROCK" = "1" ]; then
    echo -e "${GREEN}✓${NC} CLAUDE_CODE_USE_BEDROCK is enabled"
else
    echo -e "${YELLOW}⚠${NC}  CLAUDE_CODE_USE_BEDROCK not set (add to .env.local)"
fi

if [ -n "$CLAUDE_CODE_MAX_OUTPUT_TOKENS" ]; then
    echo -e "${GREEN}✓${NC} CLAUDE_CODE_MAX_OUTPUT_TOKENS set to: $CLAUDE_CODE_MAX_OUTPUT_TOKENS"
else
    echo -e "${YELLOW}⚠${NC}  CLAUDE_CODE_MAX_OUTPUT_TOKENS not set (using defaults)"
fi

if [ -n "$MAX_THINKING_TOKENS" ]; then
    echo -e "${GREEN}✓${NC} MAX_THINKING_TOKENS set to: $MAX_THINKING_TOKENS"
else
    echo -e "${YELLOW}⚠${NC}  MAX_THINKING_TOKENS not set (using defaults)"
fi

# 5. Verify Claude Code CLI (if installed)
echo -e "\n${YELLOW}5. Checking Claude Code CLI...${NC}"
if command -v claude &> /dev/null; then
    CLAUDE_VERSION=$(claude --version 2>/dev/null | head -1 || echo "unknown")
    echo -e "${GREEN}✓${NC} Claude Code CLI found: $CLAUDE_VERSION"
    
    # Check if it's configured for Bedrock
    if claude model list 2>/dev/null | grep -q "bedrock"; then
        echo -e "${GREEN}✓${NC} Claude Code CLI configured for Bedrock"
    else
        echo -e "${YELLOW}⚠${NC}  Claude Code CLI not configured for Bedrock"
        echo "   Run: export CLAUDE_CODE_USE_BEDROCK=1"
    fi
else
    echo -e "${YELLOW}⚠${NC}  Claude Code CLI not installed (optional for container)"
fi

# 6. Summary and recommendations
echo -e "\n${YELLOW}Summary:${NC}"
echo "========="

# Check if we can use Bedrock
if aws bedrock list-foundation-models --region $REGION --profile ${AWS_PROFILE:-personal} --output text > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Bedrock is accessible and ready for use${NC}"
    echo ""
    echo "Recommended models for Claude Code SDK:"
    echo "  • Primary: anthropic.claude-sonnet-4-20250514-v1:0 (Latest Sonnet 4)"
    echo "  • Fast: anthropic.claude-3-5-haiku-20241022-v1:0"
    echo "  • Powerful: anthropic.claude-opus-4-1-20250805-v1:0"
    echo ""
    echo "To use Bedrock in the container, ensure these are in .env.local:"
    echo "  CLAUDE_CODE_USE_BEDROCK=1"
    echo "  AWS_REGION=us-west-2"
    echo "  CLAUDE_CODE_MAX_OUTPUT_TOKENS=4096"
    echo "  MAX_THINKING_TOKENS=1024"
else
    echo -e "${YELLOW}⚠ Bedrock access limited - container will use simulation mode${NC}"
    echo ""
    echo "To enable Bedrock:"
    echo "  1. Attach the IAM policy from bedrock-iam-policy.json"
    echo "  2. Ensure you have Bedrock model access in us-west-2"
    echo "  3. Re-run this script to verify"
fi

# Cleanup
rm -f /tmp/bedrock-test-prompt.json /tmp/bedrock-response.json

echo ""
echo "Verification complete!"