#!/bin/bash
# Unified local development environment startup script
# Starts everything needed for local development: LocalStack, Lambda functions, Step Functions, and optionally Claude

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Parse arguments
RUN_CLAUDE=true
CLEAN_BUILD=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --no-claude)
            RUN_CLAUDE=false
            shift
            ;;
        --clean)
            CLEAN_BUILD=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  --no-claude    Skip starting Claude Code Container"
            echo "  --clean        Clean build (clear LocalStack data)"
            echo "  --verbose      Show detailed output"
            echo "  --help         Show this help message"
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

echo -e "${CYAN}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     🚀 WebOrdinary Local Development Environment   ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Components to start:${NC}"
echo "  • LocalStack (AWS services mock)"
echo "  • Lambda functions"
echo "  • Step Functions state machine"
if [ "$RUN_CLAUDE" = true ]; then
    echo "  • Claude Code Container"
fi
echo ""

# Check prerequisites
echo -e "${YELLOW}▶ Checking prerequisites...${NC}"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    echo "Please install Docker Desktop from https://www.docker.com"
    exit 1
fi

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    echo "Please install Node.js: brew install node"
    exit 1
fi

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed${NC}"
    echo "Please install AWS CLI: brew install awscli"
    exit 1
fi

echo -e "${GREEN}✓ All prerequisites met${NC}"

# Clean if requested
if [ "$CLEAN_BUILD" = true ]; then
    echo -e "\n${YELLOW}▶ Cleaning previous data...${NC}"
    rm -rf localstack-data
    docker stop localstack-main claude-main 2>/dev/null || true
    docker rm localstack-main claude-main 2>/dev/null || true
    echo -e "${GREEN}✓ Clean build initiated${NC}"
fi

# Create Docker network if it doesn't exist
if ! docker network ls | grep -q webordinary-local; then
    echo -e "\n${YELLOW}▶ Creating Docker network...${NC}"
    docker network create webordinary-local
    echo -e "${GREEN}✓ Network created${NC}"
fi

# Stop any existing containers
echo -e "\n${YELLOW}▶ Stopping existing services...${NC}"
docker stop localstack-main claude-main 2>/dev/null || true
docker rm localstack-main claude-main 2>/dev/null || true

# Start LocalStack
echo -e "\n${YELLOW}▶ Starting LocalStack...${NC}"
docker run -d --name localstack-main \
  --network webordinary-local \
  -p 4566:4566 \
  -e SERVICES=s3,sqs,dynamodb,ses,stepfunctions,lambda,logs,iam \
  -e DEBUG=$( [ "$VERBOSE" = true ] && echo "1" || echo "0" ) \
  -e LAMBDA_EXECUTOR=docker \
  -e LAMBDA_DOCKER_NETWORK=webordinary-local \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${PROJECT_ROOT}/localstack-data:/var/lib/localstack" \
  -v "${PROJECT_ROOT}/hephaestus/lib/stepfunctions:/opt/code/stepfunctions:ro" \
  localstack/localstack:latest

# Wait for LocalStack to be ready
echo -e "${YELLOW}▶ Waiting for LocalStack to initialize...${NC}"
for i in {1..30}; do
    if aws --endpoint-url=http://localhost:4566 s3 ls 2>/dev/null; then
        echo -e "${GREEN}✓ LocalStack is ready${NC}"
        break
    fi
    [ "$VERBOSE" = true ] && echo -n "." || true
    sleep 1
done

# Create AWS resources
echo -e "\n${BLUE}═══ Creating AWS Resources ═══${NC}"

# S3 Buckets
echo -e "${YELLOW}▶ Creating S3 buckets...${NC}"
for bucket in webordinary-ses-emails media-source.amelia.webordinary.com edit.amelia.webordinary.com; do
    aws --endpoint-url=http://localhost:4566 s3 mb s3://$bucket 2>/dev/null || true
    [ "$VERBOSE" = true ] && echo "  Created: $bucket" || true
done
echo -e "${GREEN}✓ S3 buckets ready${NC}"

# DynamoDB Tables
echo -e "${YELLOW}▶ Creating DynamoDB tables...${NC}"
aws --endpoint-url=http://localhost:4566 dynamodb create-table \
  --table-name webordinary-active-jobs \
  --attribute-definitions AttributeName=projectUserId,AttributeType=S \
  --key-schema AttributeName=projectUserId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST 2>/dev/null || true

aws --endpoint-url=http://localhost:4566 dynamodb create-table \
  --table-name webordinary-thread-mappings \
  --attribute-definitions AttributeName=threadId,AttributeType=S \
  --key-schema AttributeName=threadId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST 2>/dev/null || true

aws --endpoint-url=http://localhost:4566 dynamodb create-table \
  --table-name webordinary-interruptions \
  --attribute-definitions AttributeName=messageId,AttributeType=S \
  --key-schema AttributeName=messageId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST 2>/dev/null || true

echo -e "${GREEN}✓ DynamoDB tables ready${NC}"

# SQS Queues
echo -e "${YELLOW}▶ Creating SQS queues...${NC}"
aws --endpoint-url=http://localhost:4566 sqs create-queue \
  --queue-name webordinary-input-amelia-scott.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true,VisibilityTimeout=3600 2>/dev/null || true

aws --endpoint-url=http://localhost:4566 sqs create-queue \
  --queue-name webordinary-interrupts-amelia-scott \
  --attributes VisibilityTimeout=60 2>/dev/null || true

aws --endpoint-url=http://localhost:4566 sqs create-queue \
  --queue-name webordinary-dlq-amelia-scott \
  --attributes MessageRetentionPeriod=1209600 2>/dev/null || true

echo -e "${GREEN}✓ SQS queues ready${NC}"

# Build and Deploy Lambda Functions
echo -e "\n${BLUE}═══ Lambda Functions ═══${NC}"

LAMBDA_DIR="${PROJECT_ROOT}/hephaestus/lambdas"
if [ -d "$LAMBDA_DIR" ]; then
    # Define Lambda functions and their memory requirements
    LAMBDA_FUNCTIONS="intake-lambda process-attachment-lambda check-active-job-lambda rate-limited-claim-lambda send-interrupt-lambda record-interruption-lambda handle-timeout-lambda"
    
    for lambda_name in $LAMBDA_FUNCTIONS; do
        # Set memory based on function
        case $lambda_name in
            "process-attachment-lambda")
                MEMORY_SIZE=1024
                ;;
            "intake-lambda")
                MEMORY_SIZE=256
                ;;
            *)
                MEMORY_SIZE=128
                ;;
        esac
        if [ -d "$LAMBDA_DIR/$lambda_name" ]; then
            echo -e "${YELLOW}▶ Building $lambda_name...${NC}"
            cd "$LAMBDA_DIR/$lambda_name"
            
            # Install and build if package.json exists
            if [ -f "package.json" ]; then
                npm install > /dev/null 2>&1
                npm run build > /dev/null 2>&1 || true
            fi
            
            # Determine handler based on file structure
            if [ -d "dist" ]; then
                HANDLER="dist/index.handler"
                FILES_TO_ZIP="dist node_modules"
            elif [ -f "index.js" ]; then
                HANDLER="index.handler"
                FILES_TO_ZIP="index.js"
            else
                [ "$VERBOSE" = true ] && echo -e "${YELLOW}  ⚠ $lambda_name has no deployable code${NC}" || true
                continue
            fi
            
            # Package Lambda
            zip -qr function.zip $FILES_TO_ZIP -x "*.ts" "*.test.*" "node_modules/aws-sdk/*" "node_modules/@types/*"
            
            # Deploy or update Lambda
            AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
            aws --endpoint-url=http://localhost:4566 lambda create-function \
                --function-name $lambda_name \
                --runtime nodejs20.x \
                --role arn:aws:iam::000000000000:role/lambda-role \
                --handler $HANDLER \
                --zip-file fileb://function.zip \
                --timeout 60 \
                --memory-size $MEMORY_SIZE \
                --environment "Variables={AWS_LAMBDA_FUNCTION_NAME=$lambda_name}" \
                2>/dev/null || \
            AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
            aws --endpoint-url=http://localhost:4566 lambda update-function-code \
                --function-name $lambda_name \
                --zip-file fileb://function.zip \
                2>/dev/null
            
            echo -e "${GREEN}  ✓ $lambda_name deployed${NC}"
            rm function.zip
        else
            # Create stub Lambda if it doesn't exist
            echo -e "${YELLOW}  Creating stub for $lambda_name...${NC}"
            mkdir -p "$LAMBDA_DIR/$lambda_name"
            cat > "$LAMBDA_DIR/$lambda_name/index.js" << 'EOF'
exports.handler = async (event) => {
    console.log('Stub Lambda:', process.env.AWS_LAMBDA_FUNCTION_NAME);
    console.log('Event:', JSON.stringify(event, null, 2));
    
    const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown';
    
    if (functionName.includes('check-active-job')) {
        return { hasActiveJob: false };
    }
    if (functionName.includes('rate-limited-claim')) {
        return { claimed: true, containerId: 'local-container-' + Date.now() };
    }
    
    return { success: true, functionName, timestamp: new Date().toISOString() };
};
EOF
            cd "$LAMBDA_DIR/$lambda_name"
            zip -qr function.zip index.js
            
            AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
            aws --endpoint-url=http://localhost:4566 lambda create-function \
                --function-name $lambda_name \
                --runtime nodejs20.x \
                --role arn:aws:iam::000000000000:role/lambda-role \
                --handler index.handler \
                --zip-file fileb://function.zip \
                --timeout 60 \
                --memory-size $MEMORY_SIZE \
                --environment "Variables={AWS_LAMBDA_FUNCTION_NAME=$lambda_name}" \
                2>/dev/null
            
            echo -e "${GREEN}  ✓ $lambda_name deployed (stub)${NC}"
            rm function.zip
        fi
    done
    cd "$PROJECT_ROOT"
else
    echo -e "${YELLOW}⚠ Lambda functions directory not found${NC}"
fi

# Deploy Step Functions
echo -e "\n${BLUE}═══ Step Functions ═══${NC}"
echo -e "${YELLOW}▶ Deploying Step Functions state machine...${NC}"

if [ -f "hephaestus/lib/stepfunctions/email-processor.asl.json" ]; then
    ASL_DEFINITION=$(cat hephaestus/lib/stepfunctions/email-processor.asl.json)
    
    # Create the state machine
    STATE_MACHINE_ARN=$(AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
    aws --endpoint-url=http://localhost:4566 \
        stepfunctions create-state-machine \
        --name email-processor \
        --definition "$ASL_DEFINITION" \
        --role-arn "arn:aws:iam::000000000000:role/StepFunctionsRole" \
        --query 'stateMachineArn' \
        --output text 2>/dev/null || \
    AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
    aws --endpoint-url=http://localhost:4566 \
        stepfunctions list-state-machines \
        --query "stateMachines[?name=='email-processor'].stateMachineArn | [0]" \
        --output text)
    
    if [ -n "$STATE_MACHINE_ARN" ] && [ "$STATE_MACHINE_ARN" != "None" ]; then
        echo -e "${GREEN}✓ Step Functions deployed${NC}"
        [ "$VERBOSE" = true ] && echo "  ARN: $STATE_MACHINE_ARN" || true
        
        # Update intake-lambda with the ARN
        AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
        aws --endpoint-url=http://localhost:4566 lambda update-function-configuration \
            --function-name intake-lambda \
            --environment "Variables={STATE_MACHINE_ARN=${STATE_MACHINE_ARN},AWS_REGION=us-east-1}" \
            2>/dev/null || true
    fi
else
    echo -e "${YELLOW}⚠ Step Functions definition not found${NC}"
fi

# Configure S3 Event Triggers
echo -e "\n${YELLOW}▶ Configuring S3 event triggers...${NC}"
cat > /tmp/s3-notification.json << EOF
{
  "LambdaFunctionConfigurations": [
    {
      "LambdaFunctionArn": "arn:aws:lambda:us-east-1:000000000000:function:intake-lambda",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {"Name": "prefix", "Value": "emails/"}
          ]
        }
      }
    }
  ]
}
EOF

AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
aws --endpoint-url=http://localhost:4566 s3api put-bucket-notification-configuration \
    --bucket webordinary-ses-emails \
    --notification-configuration file:///tmp/s3-notification.json 2>/dev/null || true
rm /tmp/s3-notification.json
echo -e "${GREEN}✓ S3 triggers configured${NC}"

# Start Claude Code Container (optional)
if [ "$RUN_CLAUDE" = true ]; then
    echo -e "\n${BLUE}═══ Claude Code Container ═══${NC}"
    
    # Check for .env.local
    if [ ! -f "claude-code-container/.env.local" ]; then
        echo -e "${YELLOW}Creating claude-code-container/.env.local from template...${NC}"
        if [ -f "claude-code-container/.env.local.example" ]; then
            cp claude-code-container/.env.local.example claude-code-container/.env.local
        fi
    fi
    
    echo -e "${YELLOW}▶ Building Claude Code Container...${NC}"
    cd claude-code-container
    npm install > /dev/null 2>&1
    npm run build > /dev/null 2>&1
    
    # Create log directory
    LOG_DIR="/tmp/webordinary-logs"
    mkdir -p "$LOG_DIR"
    CLAUDE_LOG="$LOG_DIR/claude-output.log"
    echo "" > "$CLAUDE_LOG"
    
    # Start Claude locally
    echo -e "${YELLOW}▶ Starting Claude Code Container...${NC}"
    export AWS_ENDPOINT_URL=http://localhost:4566
    export AWS_REGION=us-east-1
    export AWS_ACCESS_KEY_ID=test
    export AWS_SECRET_ACCESS_KEY=test
    nohup ./run-local.sh > "$CLAUDE_LOG" 2>&1 &
    CLAUDE_PID=$!
    echo $CLAUDE_PID > /tmp/claude-local.pid
    cd "$PROJECT_ROOT"
    
    # Check if started
    sleep 3
    if ps -p $CLAUDE_PID > /dev/null; then
        echo -e "${GREEN}✓ Claude Code Container running (PID: $CLAUDE_PID)${NC}"
    else
        echo -e "${RED}❌ Claude Code Container failed to start${NC}"
        [ "$VERBOSE" = true ] && tail -20 "$CLAUDE_LOG" || true
    fi
fi

# Summary
echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           ✅ Environment Ready!                    ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Services Running:${NC}"
echo "  • LocalStack:     http://localhost:4566"
if [ "$RUN_CLAUDE" = true ] && [ -n "$CLAUDE_PID" ]; then
    echo "  • Claude:         Process $CLAUDE_PID"
    echo "  • Claude Logs:    tail -f $CLAUDE_LOG"
fi
echo ""
echo -e "${GREEN}Quick Commands:${NC}"
echo "  • Test email:     ./scripts/test-email.sh"
echo "  • View logs:      docker logs -f localstack-main"
echo "  • Stop all:       ./scripts/stop-local.sh"
echo "  • AWS CLI:        AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test aws --endpoint-url=http://localhost:4566 <command>"
echo ""
echo -e "${BLUE}LocalStack Dashboard:${NC} http://localhost:4566/_localstack/health"