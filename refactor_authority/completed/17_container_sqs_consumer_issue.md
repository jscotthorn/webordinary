# Container SQS Consumer Issue - Completion Entry 17

## Date: 2025-08-17

## Summary
Fixed the container image deployment issue where the wrong version was running in Fargate. The new container with GenericContainerService is now deployed and initializing correctly, but it's not processing messages from the unclaimed queue despite the SQS consumer being configured.

## What Was Completed

### 1. Identified Wrong Container Version ✅
- Fargate was using old image with QueueManagerService instead of GenericContainerService
- Container was from `webordinary/claude-code-astro` repository
- Built and pushed new image to correct repository

### 2. Deployed Correct Container ✅
- Rebuilt container with `--platform linux/amd64`
- Pushed to `webordinary/claude-code-astro:latest`
- Force redeployed ECS service with `--force-new-deployment`
- Confirmed GenericContainerService is initializing: "Generic container initialized with ID: container-1755471134026-9jyzgf5"

### 3. Verified Container Configuration ✅
- AppModule has SqsModule configured with unclaimed queue URL
- GenericContainerService is decorated with `@SqsMessageHandler('unclaimed-queue', false)`
- Container logs show correct environment variables
- Container is healthy and running in Fargate

## Current Issues

### 1. SQS Consumer Not Processing Messages
**Symptoms:**
- Container initializes but doesn't log any message reception
- Messages are consumed from unclaimed queue (count goes to 0)
- No logs about claim requests being processed
- No errors in container logs

**Possible Causes:**
- SQS consumer might not be starting correctly
- IAM permissions issue (though messages are being consumed)
- NestJS SQS module configuration issue

### 2. Step Functions Parallel State Logic Error
**Issue:** When ownership check returns `claimed: false`, the Step Functions executes BOTH branches:
- SendClaimRequest (correct)
- SendToContainerUnclaimed with waitForTaskToken (incorrect - no container listening yet)

**Fix Needed:** The parallel state should be conditional:
- If claimed: Send directly to container FIFO queue
- If unclaimed: ONLY send claim request to unclaimed queue

## Test Results

### Test 1: Old Container with Stale Ownership
- Ownership check returned `claimed: true` with old containerId
- Message sent directly to FIFO queue
- Timed out because old container no longer exists

### Test 2: New Container, No Ownership
- Ownership check returned `claimed: false`
- Both parallel branches executed (wrong)
- Claim request sent to unclaimed queue
- Message consumed but not processed by container

## Files Modified

### Container
- Built and pushed new image to ECR

### Infrastructure
- Force redeployed ECS service

## Next Steps

### 1. Debug SQS Consumer
- Add more logging to container startup
- Verify SQS consumer is actually starting
- Check if messages are reaching the handler method
- Test container locally with same configuration

### 2. Fix Step Functions Logic
- Change parallel state to conditional logic
- Use Choice state instead of Parallel when unclaimed
- Ensure only claim request is sent when no ownership exists

### 3. Verify End-to-End Flow
- Container receives and processes claim request
- Container claims ownership and starts polling FIFO queue
- Step Functions message is processed successfully
- S3 deployment works with correct project/user context

## Key Learnings

1. **Container Versioning:** Always verify the correct container image is deployed
2. **SQS Consumer Registration:** NestJS SQS consumers need proper initialization
3. **Step Functions Design:** Parallel states execute all branches - use Choice for conditional logic
4. **Debugging Approach:** Check each component in isolation before testing E2E

## Current State
- Container deployed with correct code ✅
- GenericContainerService initialized ✅
- SQS consumer configured but not processing ❌
- Step Functions logic needs correction ❌
- E2E flow not working ❌