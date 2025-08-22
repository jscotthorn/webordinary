# WebOrdinary Scripts

A collection of scripts for managing WebOrdinary infrastructure, testing, and local development.

## Infrastructure Management

### `scale-up.sh` / `scale-down.sh`
**Purpose:** Manage AWS ECS service capacity for cost optimization
- `scale-up.sh` - Scales ECS services to 1 instance for development/testing
- `scale-down.sh` - Scales ECS services to 0 instances to save costs (~$45-50/month)
- Both scripts use the `personal` AWS profile and target `us-west-2` region

## Local Development Environment

### `start-local.sh`
**Purpose:** Complete local development environment with LocalStack
- Starts LocalStack container with AWS service mocks
- Creates S3 buckets, DynamoDB tables, SQS queues
- Deploys Lambda functions from `/hephaestus/lambdas/`
- Configures Step Functions state machine
- Optionally starts Claude Code Container locally
- **Options:**
  - `--no-claude` - Skip starting Claude container
  - `--clean` - Clean build (clear LocalStack data)
  - `--verbose` - Show detailed output

### `stop-local.sh`
**Purpose:** Stops all local development services
- Stops Claude process if running
- Stops and removes LocalStack container
- Cleans up legacy containers

## Claude Container Management

### `start-local-claude.sh`
**Purpose:** Starts Claude container connected to AWS production queues
- Polls the unclaimed queue for work
- Processes messages from Step Functions
- Uses AWS Bedrock for Claude API
- Pushes changes to GitHub
- Deploys to S3
- **Options:**
  - `--build` - Build container locally before starting

### `stop-local-claude.sh`
**Purpose:** Stops the local Claude container
- Shows container statistics before stopping
- Displays recent logs
- Checks for active jobs in DynamoDB
- Removes container completely

## Testing Scripts

### `test-email.sh`
**Purpose:** Test email processing through LocalStack pipeline
- Sends test email to LocalStack S3
- Triggers Lambda and Step Functions locally
- **Options:**
  - `--with-attachment` - Include mock attachment in email
  - `--interrupt` - Test interrupt scenario
  - `--verbose` - Show detailed output

### `test-aws-email.sh`
**Purpose:** Test email directly against AWS production
- Uploads email to production S3 bucket
- Triggers production Step Functions
- Monitors execution status
- Used for testing production flow with local container

## Testing Workflows

### Local Development (with LocalStack)
```bash
# Start everything locally
./scripts/start-local.sh

# Send test email
./scripts/test-email.sh

# Monitor logs
docker logs -f localstack-main

# Stop everything
./scripts/stop-local.sh
```

### Production Testing (with local container)
```bash
# Start local container connected to AWS
./scripts/start-local-claude.sh

# Send test email to AWS
./scripts/test-aws-email.sh

# Monitor container
docker logs -f claude-local-e2e

# Stop container
./scripts/stop-local-claude.sh
```

## Environment Requirements

### Required Environment Variables
- `AWS_PROFILE` - AWS profile (usually `personal`)
- `GITHUB_TOKEN` - GitHub PAT with write permissions
- `AWS_REGION` - AWS region (default: `us-west-2`)

### Required Tools
- Docker Desktop
- AWS CLI configured with `personal` profile
- Node.js and npm
- Git

## Common Issues & Solutions

### Container won't start
```bash
# Check for existing containers
docker ps | grep claude

# Clean up old containers
docker stop $(docker ps -aq) 2>/dev/null
docker rm $(docker ps -aq) 2>/dev/null
```

### LocalStack issues
```bash
# Clean rebuild
./scripts/start-local.sh --clean

# Check LocalStack health
curl http://localhost:4566/_localstack/health
```

### AWS credentials issues
```bash
# Verify credentials
aws configure list --profile personal

# Test AWS access
AWS_PROFILE=personal aws s3 ls
```

## Cost Management

- Use `scale-down.sh` when not actively developing
- Stop local containers when not in use
- Monitor AWS costs in CloudWatch

## Docker Images

- `webordinary/claude-code-container:final-fix` - Stable production version
- `webordinary/claude-code-container:local` - Built locally with `--build`
- `localstack/localstack:latest` - LocalStack for AWS mocking