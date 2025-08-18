# Container Fargate Deployment - Completion Entry 16

## Date: 2025-08-17

## Summary
Prepared and deployed the container to Fargate for E2E testing. Fixed critical issues preventing the container from being production-ready, but discovered the container is not polling the unclaimed queue as expected.

## What Was Completed

### 1. Container Code Fixes ✅
- **S3 Sync Service**: Modified to use project/user from message context instead of environment variables
- **Context Management**: Added `setContext()` method to S3SyncService for dynamic bucket selection
- **Message Processor Integration**: Updated to set S3 context when processing messages

### 2. Docker Image Build & Push ✅
- Built container with `--platform linux/amd64` for Fargate compatibility
- Successfully pushed to ECR as `webordinary/claude-code-sqs:latest`
- Image digest: `sha256:b4502d2d2501c037a836f40beafb99c726711a99dbdf45f5bd306c3424f864b6`

### 3. Infrastructure Updates ✅
- **ECS Task Definition**: Added missing `ACTIVE_JOBS_TABLE` environment variable
- **CDK Updates**: Added `CLAUDE_CODE_USE_BEDROCK=1` for Bedrock integration
- **Script Updates**: Removed Hermes references from scale-up.sh and scale-down.sh

### 4. Deployment ✅
- Successfully deployed FargateStack with updated task definition
- Container started in Fargate cluster
- GitHub token validated successfully
- EFS workspace mounted correctly

## Current Issue: Container Not Polling Unclaimed Queue

### Symptoms
- Container starts successfully but only shows "waiting for project claim" logs
- No evidence of SQS polling or GenericContainerService activity
- Step Functions execution times out after 60 seconds
- Unclaimed queue shows 0 messages (likely consumed but not processed)

### Potential Causes
1. **Missing SQS Consumer Registration**: The GenericContainerService might not be registered as an SQS consumer
2. **Wrong Queue Configuration**: Container might be looking for wrong queue URL
3. **IAM Permissions**: Container might lack permissions to poll unclaimed queue
4. **Service Not Starting**: GenericContainerService might not be instantiated

## Files Modified

### Container Code
- `/claude-code-container/src/services/s3-sync.service.ts` - Added context management
- `/claude-code-container/src/services/message-processor.service.ts` - Set S3 context

### Infrastructure
- `/hephaestus/lib/fargate-stack.ts` - Updated environment variables
- `/scripts/scale-up.sh` - Removed Hermes references
- `/scripts/scale-down.sh` - Removed Hermes references

## Test Results

### What Works
- Container builds and runs in Fargate ✅
- Step Functions execution starts correctly ✅
- Ownership check returns `claimed: false` as expected ✅
- Message routes to unclaimed queue path ✅

### What Doesn't Work
- Container doesn't poll unclaimed queue ❌
- No claim requests being processed ❌
- Messages timeout waiting for container response ❌

## Next Steps for Debugging

### 1. Verify SQS Consumer Registration
Check if GenericContainerService is properly decorated with `@SqsMessageHandler` or similar

### 2. Check AppModule Configuration
Verify the SqsModule is configured with correct queue URL in app.module.ts

### 3. Review Container Logs
Look for any initialization errors or missing configuration warnings

### 4. Test Locally
Run container locally with same environment variables to debug startup issues

### 5. Check IAM Permissions
Verify task role has permissions for:
- `sqs:ReceiveMessage` on unclaimed queue
- `sqs:DeleteMessage` on unclaimed queue
- `dynamodb:PutItem` on ownership table

### 6. Validate Queue URL
Ensure `UNCLAIMED_QUEUE_URL` environment variable matches actual queue

## Key Learnings

1. **Container Readiness**: Even with successful deployment, runtime behavior needs validation
2. **SQS Integration**: NestJS SQS consumer registration is critical for queue polling
3. **Logging Importance**: Need more verbose startup logging to diagnose issues
4. **E2E Testing**: Full flow testing reveals integration issues not caught in unit tests

## Current State
- Container deployed but not functional for message processing
- Infrastructure ready but container needs debugging
- Step Functions flow working correctly up to container handoff