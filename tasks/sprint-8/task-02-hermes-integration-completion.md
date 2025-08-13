# Hermes SQS Integration Completion

## Overview
Successfully wired up the SQS executor service in Hermes to replace HTTP-based communication with queue-based messaging.

## What Was Accomplished

### 1. Updated Claude Executor Module
- Added `SqsExecutorService` alongside existing `ClaudeExecutorService`
- Imported `MessageProcessorModule` for dependency injection
- Maintained backwards compatibility

### 2. Created Message Processor Module
- New module at `/hermes/src/modules/message-processor/message-processor.module.ts`
- Exports `MessageRouterService` for use across the application

### 3. Updated Email Processor Service
- Replaced `ClaudeExecutorService` with `SqsExecutorService`
- Injected `MessageRouterService` directly (no more dynamic imports)
- Updated `executeInstruction` call to include `threadId` parameter
- Simplified session creation with injected router service

### 4. Module Dependencies Fixed
- Added `MessageProcessorModule` to `EmailProcessorModule` imports
- Added `MessageProcessorModule` to `ClaudeExecutorModule` imports
- Ensured proper dependency injection chain

### 5. Build Script Enhancement
- Updated `build-and-push.sh` to include `--platform linux/amd64` flag
- Essential for ECS compatibility

## Architecture Flow

```
Email Arrives → SES → SQS
    ↓
Hermes Processes Email
    ↓
MessageRouterService Identifies Project+User
    ↓
SqsExecutorService Routes to Project Queue
    ↓
Checks Container Ownership
    ↓
If No Owner → Sends Claim Request to Unclaimed Queue
    ↓
Container Claims & Processes
    ↓
Response via Output Queue
    ↓
Hermes Sends Email Reply
```

## Next Steps - Deployment Commands

```bash
# 1. Build and push Hermes
cd /Users/scott/Projects/webordinary/hermes
./build-and-push.sh sqs-v1

# 2. Build and push Container
cd /Users/scott/Projects/webordinary/claude-code-container
./build-claim.sh

# 3. Deploy infrastructure changes
cd /Users/scott/Projects/webordinary/hephaestus
npx cdk deploy SqsStack FargateStack HermesStack --profile personal

# 4. Force new deployments
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-hermes-service \
  --force-new-deployment

AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --force-new-deployment

# 5. Scale up services
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-hermes-service \
  --desired-count 1

AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --desired-count 1
```

## Testing Checklist

1. **Verify Queue Creation**:
   ```bash
   AWS_PROFILE=personal aws sqs list-queues --queue-name-prefix webordinary
   ```

2. **Check Ownership Table**:
   ```bash
   AWS_PROFILE=personal aws dynamodb describe-table \
     --table-name webordinary-container-ownership
   ```

3. **Send Test Email**:
   - Send to: buddy@webordinary.com
   - From: escottster@gmail.com
   - Subject: Test queue routing
   - Body: Update the homepage title

4. **Monitor Logs**:
   ```bash
   # Hermes logs
   AWS_PROFILE=personal aws logs tail /ecs/hermes --since 5m
   
   # Container logs
   AWS_PROFILE=personal aws logs tail /ecs/webordinary/edit --since 5m
   ```

5. **Check Queue Messages**:
   ```bash
   # Check unclaimed queue
   AWS_PROFILE=personal aws sqs get-queue-attributes \
     --queue-url https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed \
     --attribute-names ApproximateNumberOfMessages
   
   # Check project queue
   AWS_PROFILE=personal aws sqs get-queue-attributes \
     --queue-url https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-input-ameliastamps-scott \
     --attribute-names ApproximateNumberOfMessages
   ```

## Files Modified
- `/hermes/src/modules/claude-executor/claude-executor.module.ts`
- `/hermes/src/modules/claude-executor/sqs-executor.service.ts`
- `/hermes/src/modules/email-processor/email-processor.service.ts`
- `/hermes/src/modules/email-processor/email-processor.module.ts`
- `/hermes/src/modules/message-processor/message-processor.module.ts` (new)
- `/hermes/build-and-push.sh`

## Key Design Decisions
1. **Kept ClaudeExecutorService** for backwards compatibility
2. **Direct dependency injection** instead of dynamic imports
3. **Module-based organization** for clean separation of concerns
4. **Platform flag enforcement** in build scripts

## Status
✅ Implementation Complete
⏳ Ready for deployment and testing