# Container Claim Mechanism Implementation

## Overview
Implemented the container claim mechanism for the queue-based communication pattern between Hermes and containers.

## What Was Accomplished

### 1. Created QueueManagerService (`/claude-code-container/src/services/queue-manager.service.ts`)
- Polls unclaimed queue when idle
- Claims ownership of project+user combinations atomically
- Switches to project-specific queues after claiming
- Releases ownership after 30 minutes of inactivity
- Handles message routing to appropriate queues

### 2. Updated Container Bootstrap (`/claude-code-container/src/main.ts`)
- Integrated QueueManagerService into startup flow
- Removed hardcoded queue URLs
- Set up event-based message processing
- Added graceful shutdown with ownership release

### 3. Modified App Module (`/claude-code-container/src/app.module.ts`)
- Added QueueManagerService as provider
- Removed static SQS consumer/producer configuration
- Exported necessary services for dependency injection

### 4. Updated Fargate Stack (`/hephaestus/lib/fargate-stack.ts`)
- Added UNCLAIMED_QUEUE_URL environment variable
- Added OWNERSHIP_TABLE_NAME environment variable
- Added AWS_ACCOUNT_ID and AWS_REGION for queue URL construction
- Added DynamoDB permissions for container ownership table

### 5. Created Build Script (`/claude-code-container/build-claim.sh`)
- Automated build and push process
- Uses correct platform flag (linux/amd64)
- Tags as both claim-v1 and latest

## Architecture Summary

```
Container Startup
    ↓
Poll Unclaimed Queue
    ↓
Receive Claim Request (projectId, userId)
    ↓
Atomic DynamoDB PutItem (with condition)
    ↓
If Successful → Switch to Project Queues
    ↓
Poll Project Input Queue
    ↓
Process Messages → Send to Output Queue
    ↓
After 30min Idle → Release & Return to Unclaimed
```

## Key Design Elements

1. **Atomic Claiming**: Uses DynamoDB conditional writes to prevent race conditions
2. **Auto-Release**: Containers release ownership after 30 minutes of inactivity
3. **Dynamic Queue URLs**: Constructs queue URLs based on claimed project+user
4. **Container ID**: Uses ECS task ARN or generates unique ID
5. **TTL Support**: DynamoDB entries expire after 1 hour as safety mechanism

## Next Steps

### Immediate Actions Required
1. **Build and Push Container**:
   ```bash
   cd /Users/scott/Projects/webordinary/claude-code-container
   ./build-claim.sh
   ```

2. **Deploy Infrastructure**:
   ```bash
   cd /Users/scott/Projects/webordinary/hephaestus
   npx cdk deploy SqsStack FargateStack --profile personal
   ```

3. **Scale Up Service**:
   ```bash
   AWS_PROFILE=personal aws ecs update-service \
     --cluster webordinary-edit-cluster \
     --service webordinary-edit-service \
     --desired-count 1
   ```

### Testing Steps
1. Send email to edit@webordinary.com
2. Monitor unclaimed queue for claim request
3. Check ownership table for successful claim
4. Verify message processing in project queues
5. Check S3 deployment succeeded

### Future Enhancements
1. Move email-to-project mapping from hardcoded to DynamoDB
2. Add CloudWatch metrics for claim success/failure rates
3. Implement container warm-up optimization
4. Add circuit breaker for failed claims
5. Create dashboard for container ownership visibility

## Files Modified
- `/claude-code-container/src/services/queue-manager.service.ts` (new)
- `/claude-code-container/src/main.ts`
- `/claude-code-container/src/app.module.ts`
- `/claude-code-container/src/message-processor.service.ts`
- `/hephaestus/lib/fargate-stack.ts`
- `/claude-code-container/build-claim.sh` (new)

## Time Spent
Approximately 1 hour for implementation and documentation

## Status
✅ Implementation Complete
⏳ Awaiting build, deployment, and testing