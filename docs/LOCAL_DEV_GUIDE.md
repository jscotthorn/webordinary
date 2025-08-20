# Local Development Guide

## ⚠️ MAJOR UPDATE: Lambda-based Development (2025-08-19)

Hermes has been replaced with Lambda functions and Step Functions. Use the new Lambda development environment for local testing.

**Latest Updates:**
- Docker-based E2E testing for claude-code-container
- Fixed merge conflicts in container services
- New test scripts for container validation

## Quick Start

### Unified Local Development (Current Approach)
Everything runs locally with LocalStack:

```bash
# Start everything (LocalStack, Lambdas, Step Functions)
./scripts/start-local.sh

# Optional: Skip Claude Code Container
./scripts/start-local.sh --no-claude

# Test email processing
./scripts/test-email.sh

# Test with attachment
./scripts/test-email.sh --with-attachment

# Test interrupt scenario
./scripts/test-email.sh --interrupt

# Stop all services
./scripts/stop-local.sh
```

**Available Scripts (only 3!):**
- `start-local.sh` - Starts everything needed for local development
- `stop-local.sh` - Cleanly stops all services
- `test-email.sh` - Comprehensive testing tool

**Benefits:**
- Full AWS service mocking with LocalStack
- Automatic Lambda deployment and updates
- Step Functions orchestration
- S3 event triggers configured automatically
- No Hermes dependency
- Stub Lambda generation for missing functions
- Accurate production simulation

## Lambda Development Environment

### Architecture
```
Email → S3 → Lambda → Step Functions → Container → S3 → User
```

### What's Included
- **LocalStack**: Mocks AWS services locally
  - S3 buckets with event triggers
  - Lambda function runtime
  - SQS queues (FIFO and standard)
  - DynamoDB tables
  - Step Functions (coming in Sprint 3)
- **Lambda Functions**:
  - `intake-lambda`: Processes emails from S3
  - `process-attachment-lambda`: Optimizes images with Sharp
- **Claude Code Container**: Runs locally or in Docker

### LocalStack Endpoints
All AWS services are available at `http://localhost:4566`:
- S3: `aws --endpoint-url=http://localhost:4566 s3 ls`
- Lambda: `aws --endpoint-url=http://localhost:4566 lambda list-functions`
- SQS: `aws --endpoint-url=http://localhost:4566 sqs list-queues`
- DynamoDB: `aws --endpoint-url=http://localhost:4566 dynamodb list-tables`

**Important**: Use test credentials for LocalStack:
```bash
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
```

### Prerequisites
- Docker Desktop installed and running
- Node.js 20+ (`brew install node`)
- AWS CLI (`brew install awscli`)
- No AWS credentials needed (LocalStack uses test credentials)

### Lambda Functions

#### intake-lambda
- **Location**: `/hephaestus/lambdas/intake-lambda/`
- **Purpose**: Process incoming emails from S3
- **Trigger**: S3 ObjectCreated events on `emails/` prefix
- **Actions**:
  - Parses email using mailparser
  - Extracts thread ID, project, and user
  - Starts Step Functions execution

#### process-attachment-lambda  
- **Location**: `/hephaestus/lambdas/process-attachment-lambda/`
- **Purpose**: Optimize email attachments
- **Features**:
  - Creates WebP versions for modern browsers
  - Generates thumbnails (400px max)
  - Creates web-optimized versions (1200px max)
  - Uses Sharp for image processing (requires container deployment in production)
  - Simplified JavaScript version for local testing

#### Support Lambda Functions (Stubs)
The following Lambda functions are automatically created as stubs by `start-local.sh`:
- **check-active-job-lambda**: Checks for active jobs in DynamoDB
- **rate-limited-claim-lambda**: Claims a job with rate limiting
- **send-interrupt-lambda**: Sends interrupt messages
- **record-interruption-lambda**: Records interruption events
- **handle-timeout-lambda**: Handles Step Functions timeouts

These stubs will be replaced with full implementations in Sprint 2 Day 6-7.

### Building and Deploying Lambdas

**Automatic Deployment:**
```bash
# start-local.sh automatically:
# 1. Builds all Lambda functions with package.json
# 2. Creates stubs for missing Lambda functions
# 3. Deploys all functions to LocalStack
# 4. Configures proper memory settings (256MB for intake, 1GB for attachments, 128MB for others)
./scripts/start-local.sh
```

**Manual Deployment (if needed):**
```bash
# Build Lambda function
cd hephaestus/lambdas/intake-lambda
npm install
npm run build

# Package for deployment
zip -r function.zip dist/ node_modules/

# Deploy to LocalStack
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
aws --endpoint-url=http://localhost:4566 lambda create-function \
  --function-name intake-lambda \
  --runtime nodejs20.x \
  --handler dist/index.handler \
  --zip-file fileb://function.zip \
  --memory-size 256 \
  --timeout 60
```

## Testing Workflow

### 1. Start Services
```bash
./scripts/start-lambda-dev.sh
```

This will:
- Start LocalStack container
- Create S3 buckets and DynamoDB tables
- Build and deploy Lambda functions
- Configure S3 event triggers
- Start Claude Code Container (optional)

### 2. Send Test Email
```bash
./scripts/test-lambda-email.sh
```

This will:
- Create a sample email file
- Upload to S3 bucket `webordinary-ses-emails/emails/`
- Trigger Lambda automatically via S3 event
- Show Lambda logs and queue status

### 3. Monitor Processing
```bash
# View LocalStack logs (includes Lambda execution)
docker logs -f localstack-manual

# Check Lambda function logs
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
aws --endpoint-url=http://localhost:4566 \
logs tail /aws/lambda/intake-lambda --since 5m

# Monitor Claude container (if running)
tail -f /tmp/webordinary-logs/claude-output.log
```

### 4. Verify Results
```bash
# List S3 objects
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
aws --endpoint-url=http://localhost:4566 s3 ls s3://webordinary-ses-emails/

# Check SQS queues
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
aws --endpoint-url=http://localhost:4566 sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/webordinary-input-amelia-scott.fifo \
  --attribute-names All
```

## Docker-based E2E Testing (New!)

### Overview
Test the claude-code-container in a production-like Docker environment with real AWS credentials and GitHub token.

### Prerequisites
- Docker Desktop running
- GitHub personal access token in environment: `export GITHUB_TOKEN=your_token`
- AWS credentials configured: `~/.aws/credentials` with `personal` profile

### Quick Test
```bash
# From project root
cd claude-code-container
npm run test:docker
```

### Test Commands
```bash
# Build Docker image only
npm run test:docker:build

# Run basic E2E test
npm run test:docker

# View container logs
npm run test:docker:logs

# Clean up containers
npm run test:docker:clean
```

### Advanced Testing
```bash
# Test with SQS message
./scripts/test-container-with-message.sh

# Run specific test scenarios
./scripts/test-container-e2e.sh test basic
./scripts/test-container-e2e.sh test s3
./scripts/test-container-e2e.sh test stepfunction
```

### Docker Test Configuration
The `docker-compose.test.yml` file configures:
- AWS credentials from host machine
- GitHub token for repository access
- Queue URLs and DynamoDB tables
- Workspace volume mounting
- Resource limits (2GB RAM, 1 CPU)

### Troubleshooting Docker Tests
```bash
# Check if container is running
docker ps | grep claude-e2e-test

# View detailed logs
docker logs claude-e2e-test

# Check DynamoDB ownership
AWS_PROFILE=personal aws dynamodb scan \
  --table-name webordinary-container-ownership \
  --limit 5

# Clean up stuck containers
docker stop claude-e2e-test && docker rm claude-e2e-test
```

## Common Issues and Solutions

### Merge Conflicts in Container Code
If you encounter TypeScript build errors with merge conflict markers:
```bash
# The container code has been fixed, but if you see errors like:
# error TS1185: Merge conflict marker encountered

# Clean and rebuild
cd claude-code-container
npm run build

# If conflicts persist, check for conflict markers
grep -r "<<<<<<< " src/
```

### Docker Container Platform Warning
```bash
# If you see: "The requested image's platform (linux/amd64) does not match"
# This is expected on Apple Silicon Macs (M1/M2/M3)
# The container still runs correctly under emulation
# To suppress the warning, you can build for ARM64:
docker build --platform linux/arm64 -t webordinary/claude-code-test:latest .
```

### Missing auto-shutdown.sh Script
```bash
# If you see: "/app/scripts/auto-shutdown.sh: No such file or directory"
# This is a non-critical warning that can be ignored
# The script reference will be removed in the next update
```

### LocalStack Won't Start
```bash
# Check if port 4566 is in use
lsof -i :4566

# Stop any running LocalStack instances
docker stop localstack-main
docker rm localstack-main

# Restart with clean state
rm -rf /Users/scott/Projects/webordinary/localstack-data
./scripts/start-local.sh
```

### Lambda Not Triggering
```bash
# Verify S3 notification configuration
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
aws --endpoint-url=http://localhost:4566 \
s3api get-bucket-notification-configuration \
--bucket webordinary-ses-emails

# Check Lambda function exists
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
aws --endpoint-url=http://localhost:4566 \
lambda get-function --function-name intake-lambda
```

### TypeScript Build Errors
```bash
# Clean and rebuild
cd hephaestus/lambdas/intake-lambda
rm -rf dist/ node_modules/
npm install
npm run build
```

### Step Functions Limitations
- **States.Format Not Supported**: LocalStack doesn't fully support the States.Format intrinsic function
- **Workaround**: The state machine uses simplified parameters for local testing
- **Impact**: Some states may fail locally but will work in production AWS
- **Note**: This is a LocalStack limitation, not an issue with our implementation

### Sharp Module Issues
```bash
# If you see "Could not load the 'sharp' module" error:
# This is expected in LocalStack - Sharp requires platform-specific binaries
# The process-attachment-lambda uses a simplified mock for local testing
# Production deployment will use a Docker container with proper Sharp support
```

### S3 Bucket Not Created
```bash
# If S3 operations fail with "NoSuchBucket":
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
aws --endpoint-url=http://localhost:4566 s3 mb s3://webordinary-ses-emails

# Then reconfigure notifications:
./scripts/start-local.sh
```

## Architecture Flow (New Lambda-based)

```
1. Email → S3 (webordinary-ses-emails bucket)
2. S3 Event → Lambda (intake-lambda)
3. Lambda parses email and extracts metadata
4. Lambda starts Step Functions execution (Sprint 3)
5. Step Functions orchestrates:
   - Check for active jobs
   - Process attachments (process-attachment-lambda)
   - Send to container queue
6. Container processes message:
   - Polls from SQS queue
   - Executes Claude Code
   - Commits and pushes changes
   - Deploys to S3
7. Container sends callback to Step Functions
```

## Key Components

### LocalStack Resources
- **S3 Buckets**:
  - `webordinary-ses-emails` (email storage)
  - `media-source.amelia.webordinary.com` (attachments)
  - `edit.amelia.webordinary.com` (deployed site)
  
- **SQS Queues**:
  - `webordinary-input-amelia-scott.fifo` (work queue)
  - `webordinary-interrupts-amelia-scott` (interrupt queue)
  - `webordinary-dlq-amelia-scott` (dead letter queue)
  
- **DynamoDB Tables**:
  - `webordinary-active-jobs` (job tracking)
  - `webordinary-thread-mappings` (thread management)

### Environment Variables

#### Lambda Functions
```bash
# Automatically set by LocalStack
AWS_REGION=us-east-1
STATE_MACHINE_ARN=arn:aws:states:us-east-1:000000000000:stateMachine:email-processor
```

#### Claude Code Container (.env.local)
```bash
# Use LocalStack endpoints
AWS_ENDPOINT_URL=http://localhost:4566
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

# Workspace configuration
WORKSPACE_PATH=/workspace

# GitHub token for pushing branches
GITHUB_TOKEN=your_github_pat_token
```

## Migration from Hermes

### What Changed
- **Removed**: Hermes service and all dependencies
- **Removed**: Direct SQS polling from email queue
- **Added**: Lambda functions for email processing
- **Added**: LocalStack for AWS service mocking
- **Added**: S3 event-driven architecture

### Scripts to Update
If you have custom scripts, update them to:
1. Remove Hermes container references
2. Use LocalStack endpoints (http://localhost:4566)
3. Use test AWS credentials
4. Trigger via S3 uploads instead of SQS messages

## Current Status (Sprint 2 Day 5 Complete - 2025-08-19)

### ✅ Completed
- Lambda functions: intake-lambda, process-attachment-lambda
- Step Functions state machine definition and deployment
- LocalStack integration with all AWS services
- Unified development scripts
- S3 event triggers
- Automatic stub Lambda generation
- **Docker-based E2E testing for claude-code-container**
- **Fixed merge conflicts in container services**
- **Container successfully claims work from SQS queues**
- **DynamoDB ownership tracking validated**

### 🚧 In Progress (Sprint 2 Day 6-7)
- Support Lambda implementations (currently stubs):
  - check-active-job-lambda
  - rate-limited-claim-lambda
  - record-interruption-lambda
  - handle-timeout-lambda
- Unit tests with mocked AWS services
- Full Step Functions integration testing

### 📅 Upcoming (Sprint 3)
- Production CDK deployment
- CloudWatch integration
- Error handling and retry improvements
- Performance optimization
- Remove deprecated auto-shutdown.sh reference

## Support

For issues or questions:
- Check LocalStack logs: `docker logs localstack-main`
- Verify AWS CLI works: `AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test aws --endpoint-url=http://localhost:4566 s3 ls`
- Ensure Docker is running: `docker ps`
- Review Lambda logs in LocalStack output
- Check Step Functions execution: `AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test aws --endpoint-url=http://localhost:4566 stepfunctions list-executions --state-machine-arn arn:aws:states:us-east-1:000000000000:stateMachine:email-processor`