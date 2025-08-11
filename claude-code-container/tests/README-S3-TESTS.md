# S3 Architecture Test Suite

## Overview
This test suite has been updated to support the new S3 static hosting architecture (Sprint 6 & 7).

### Key Changes
- **No ALB routing tests** - Replaced with S3 deployment verification
- **No HTTP health checks** - Using CloudWatch logs for container status
- **S3 as deployment target** - All tests verify S3 bucket content
- **AWS Profile required** - Tests use `personal` AWS profile for credentials

## Running Tests

### Prerequisites
- AWS CLI configured with `personal` profile
- Valid AWS credentials (not SSO/temporary)
- Node.js 18+ installed

### Quick Start

```bash
# Run all tests with AWS profile
npm run test:aws:all

# Run specific test suites
npm run test:aws:container    # Container integration test
npm run test:aws:multi        # Multi-session test

# Or use the helper script
./test-with-profile.sh all
./test-with-profile.sh container
./test-with-profile.sh integration
```

### Manual AWS Profile Setup

```bash
# Set AWS profile for current session
export AWS_PROFILE=personal
export AWS_REGION=us-west-2

# Verify credentials
aws sts get-caller-identity

# Run tests
npm test all
```

## Test Configuration

### S3 Buckets
- **Production**: `edit.amelia.webordinary.com`
- **Test**: `edit.test.webordinary.com` (if configured)

### S3 Website Endpoints
- **Direct S3**: `http://edit.amelia.webordinary.com.s3-website-us-west-2.amazonaws.com`
- **Domain**: `http://edit.amelia.webordinary.com` (if Route53 configured)

### SQS Queues
- **Input**: `webordinary-email-queue`
- **DLQ**: `webordinary-email-dlq`

## Test Suites

### 1. Container Integration (`container.test.js`)
- Sends messages to SQS
- Verifies S3 deployment
- Checks S3 website accessibility
- No longer checks HTTP endpoints

### 2. S3 Deployment Tests (`04-s3-deployment.test.ts`)
Previously ALB routing tests, now covers:
- S3 deployment after message processing
- File updates and sync verification
- Multi-client deployments
- Build failure handling
- Performance metrics
- Content integrity

### 3. Multi-Session Tests (`multi-session.test.js`)
- Tests session switching with S3 deployments
- Concurrent user S3 deployments
- Verifies each session deploys to S3

### 4. Test Harness (`integration-test-harness.ts`)
New S3-specific methods:
- `waitForS3Deployment()` - Waits for S3 deployment
- `verifyS3Content()` - Checks deployed content
- `listS3Objects()` - Lists bucket contents
- `waitForContainerStartup()` - Uses CloudWatch logs
- `waitForProcessing()` - Monitors CloudWatch for completion

## Common Issues

### AWS Credentials
If you see "Token is expired" or authentication errors:
```bash
# For IAM user credentials (recommended for tests)
aws configure --profile personal

# For SSO (not recommended for automated tests)
aws sso login --profile personal
```

### S3 Bucket Access
Ensure your AWS profile has permissions for:
- `s3:ListBucket`
- `s3:GetObject`
- `s3:HeadObject`
- `sqs:SendMessage`
- `sqs:GetQueueAttributes`
- `logs:FilterLogEvents`

### Container Not Running
The warning "Container may not be running locally" is expected when:
- Running tests outside of Docker
- Testing against AWS infrastructure
- Container is managed by ECS

## Architecture Notes

### Old Architecture (Pre-Sprint 6)
```
User → ALB → Container:8080 → Astro Dev Server
```

### New Architecture (Sprint 6+)
```
User → S3 Website
SQS → Container → Build → S3 Sync
```

### What Changed
- Containers no longer serve web traffic
- S3 serves static sites directly
- Containers only process messages and deploy
- Health checks via CloudWatch logs, not HTTP
- ALB only routes to Lambda/Hermes, not containers

## Debugging

### Check S3 Deployment
```bash
# List bucket contents
AWS_PROFILE=personal aws s3 ls s3://edit.amelia.webordinary.com/

# Check specific file
AWS_PROFILE=personal aws s3api head-object \
  --bucket edit.amelia.webordinary.com \
  --key index.html

# View website
curl http://edit.amelia.webordinary.com.s3-website-us-west-2.amazonaws.com
```

### Check SQS Queue
```bash
# Get queue stats
AWS_PROFILE=personal aws sqs get-queue-attributes \
  --queue-url https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-queue \
  --attribute-names All
```

### Check CloudWatch Logs
```bash
# View container logs
AWS_PROFILE=personal aws logs tail /ecs/webordinary/edit --since 10m
```

## Next Steps

If tests are failing:
1. Verify AWS credentials are valid
2. Check S3 bucket exists and has content
3. Ensure SQS queue is accessible
4. Verify CloudWatch log group exists
5. Check ECS service is running (if testing against live infra)

For local testing without AWS:
- Use mock/simulation modes in tests
- Run container locally with Docker
- Use LocalStack for AWS service emulation