# Unclaimed Queue Pattern Implementation Complete

## Date: 2025-08-17

## Summary
Successfully implemented the unclaimed queue pattern for generic containers as originally intended in the proposal. Containers now claim project+user work dynamically rather than being tied to specific projects at startup.

## Architecture Change

### Before (Direct Routing Only)
```
Step Functions → webordinary-input-{project}-{user}.fifo → Container(project-specific)
```
- Container required PROJECT_ID and USER_ID at startup
- One container needed per project+user combination
- High cost with idle containers

### After (Generic Containers with Claiming)
```
Step Functions → Check Ownership → If Unclaimed:
                                    ├── webordinary-input-{project}-{user}.fifo
                                    └── webordinary-unclaimed → Any Container → Claims → Polls FIFO
```
- Containers are generic, poll unclaimed queue
- Dynamically claim project+user work
- Can handle ANY project+user after claiming
- Release ownership after 30 minutes idle

## Key Components Implemented

### 1. Step Functions ASL Updates ✅
**File**: `/hephaestus/lib/stepfunctions/email-processor.asl.json`

Added routing logic after ClaimJob:
- CheckIfClaimed choice state
- SendToUnclaimedQueue parallel state
- Sends CLAIM_REQUEST to unclaimed queue when no container owns project+user

### 2. Generic Container Service ✅
**File**: `/claude-code-container/src/services/generic-container.service.ts`

New service that:
- Polls unclaimed queue for CLAIM_REQUEST messages
- Claims project+user via DynamoDB conditional write
- Dynamically starts polling project-specific FIFO queue
- Releases ownership after 30 minutes of inactivity
- Handles interrupts by releasing ownership

### 3. Infrastructure Updates ✅

#### SQS Stack
- Added `webordinary-unclaimed` queue (Standard, not FIFO)
- Added `webordinary-container-ownership` DynamoDB table
- Both already referenced in proposal but now properly created

#### Container Updates
- Removed fixed PROJECT_ID/USER_ID requirements
- Updated main.ts to show generic container status
- app.module.ts now configures unclaimed queue consumer

### 4. Message Flow

#### Claiming Process
1. Container polls `webordinary-unclaimed` queue
2. Receives CLAIM_REQUEST with project, user, and queue URL
3. Attempts atomic claim in DynamoDB (conditional write)
4. If successful, starts polling project-specific FIFO queue
5. If failed (already claimed), lets message return for another container

#### Processing Flow
1. After claiming, polls project FIFO queue
2. Receives Step Functions message with task token
3. Processes with existing MessageProcessor
4. Sends callbacks to Step Functions
5. Updates activity timestamp in ownership table

#### Release Process
1. After 30 minutes idle, releases ownership
2. Deletes entry from ownership table
3. Returns to polling unclaimed queue
4. Container becomes available for any project+user

## Environment Variables

### Removed
- ❌ PROJECT_ID (no longer needed)
- ❌ USER_ID (no longer needed)
- ❌ INPUT_QUEUE_URL (determined dynamically)

### Added/Required
- ✅ UNCLAIMED_QUEUE_URL (webordinary-unclaimed)
- ✅ OWNERSHIP_TABLE_NAME (webordinary-container-ownership)
- ✅ ACTIVE_JOBS_TABLE (webordinary-active-jobs)
- ✅ AWS_REGION
- ✅ AWS_ACCOUNT_ID
- ✅ WORKSPACE_PATH

## Benefits of Generic Containers

### Cost Optimization
- **Before**: 10 projects × 10 users = 100 containers needed
- **After**: 2-3 generic containers handle all traffic
- **Savings**: ~97% reduction in container costs

### Resource Utilization
- Containers stay warm and ready
- No cold starts for active users
- Automatic load distribution
- Self-balancing across available containers

### Scalability
- Easy to add more containers under load
- No configuration changes needed
- New containers automatically join pool
- ECS auto-scaling works seamlessly

## Testing Scenarios

### 1. Single Container, Multiple Projects
```bash
# Container 1 starts, polls unclaimed
# Email 1: amelia+scott → Container 1 claims
# Email 2: project2+john → Waits in unclaimed
# After 30 min idle, Container 1 releases amelia+scott
# Container 1 claims project2+john
```

### 2. Multiple Containers, Load Distribution
```bash
# Container 1 & 2 polling unclaimed
# Email 1: amelia+scott → Container 1 claims
# Email 2: project2+john → Container 2 claims
# Both process in parallel
```

### 3. Interruption Handling
```bash
# Container 1 processing amelia+scott
# New email for amelia+scott arrives
# Interrupt sent to Container 1
# Container 1 releases ownership
# Message returns to unclaimed
# Any container (including Container 1) can reclaim
```

## Files Modified

### Container
- ✅ `/src/services/generic-container.service.ts` - NEW
- ✅ `/src/app.module.ts` - Use unclaimed queue
- ✅ `/src/main.ts` - Generic startup logging
- ✅ `/src/services/queue-manager.service.ts` - Restored for reference

### Infrastructure
- ✅ `/hephaestus/lib/stepfunctions/email-processor.asl.json` - Added routing
- ✅ `/hephaestus/lib/sqs-stack.ts` - Added unclaimed queue & ownership table
- ✅ `/hephaestus/lib/fargate-stack.ts` - Already had UNCLAIMED_QUEUE_URL

## Deployment Steps

1. Deploy infrastructure changes:
```bash
npx cdk deploy SqsStack --profile personal
npx cdk deploy StepFunctionsStack --profile personal
```

2. Build and push new container:
```bash
./build.sh
docker tag webordinary/claude-code:latest $ECR_URI:generic-v1
docker push $ECR_URI:generic-v1
```

3. Update ECS service:
```bash
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --task-definition FargateStackEditTaskDef7F513F8D:latest \
  --desired-count 2  # Start with 2 generic containers
```

## Monitoring

### Key Metrics
- Unclaimed queue depth (pending claims)
- Container ownership table item count (active claims)
- Container idle time before release
- Claim success/failure rate
- Average time to claim

### CloudWatch Queries
```sql
-- Active container claims
SELECT projectKey, containerId, lastActivity
FROM webordinary-container-ownership
WHERE ttl > CURRENT_TIMESTAMP

-- Unclaimed messages waiting
SELECT COUNT(*) as pending_claims
FROM webordinary-unclaimed
```

## Conclusion

The unclaimed queue pattern has been successfully implemented, aligning with the original proposal's intent. Containers are now truly generic and can handle any project+user combination through dynamic claiming. This provides significant cost savings and better resource utilization while maintaining the ability to process messages with Step Functions callbacks.

The implementation improves on the proposal by using event-driven patterns and cleaner separation of concerns, while maintaining all critical functionality including heartbeats, visibility extensions, and FIFO queue unblocking on interrupts.