# Unclaimed Queue Testing & Findings

## Date: 2025-08-17

## Summary
Deployed Step Functions changes and tested the unclaimed queue pattern with a locally running container. Discovered a critical issue in the implementation that prevents the pattern from working correctly.

## What Was Completed

### 1. Infrastructure Deployment ✅
- Successfully deployed StepFunctionsStack with new ASL routing logic
- Fixed duplicate table/queue definitions in SqsStack
- Confirmed unclaimed queue and container-ownership table exist in AWS

### 2. Container Updates ✅
- Built and ran container locally with generic configuration
- Container successfully polls unclaimed queue
- Removed PROJECT_ID/USER_ID requirements from startup
- Fixed build issues by removing queue-manager dependencies

### 3. Testing Setup ✅
- Created `/scripts/test-aws-email.sh` for AWS testing (not LocalStack)
- Successfully triggered Step Functions execution via S3 event
- Container running locally waiting for claim requests

## Critical Finding: Rate-Limited-Claim-Lambda Issue 🔴

### The Problem
The `rate-limited-claim-lambda` is incorrectly claiming ownership instead of just checking if a container owns the project+user.

### Evidence
```json
"claimResult": {
  "Payload": {
    "success": true,
    "projectUserId": "amelia#scott",
    "containerId": "container-1755464629144-vp5l",  // Lambda generated this!
    "expiresAt": 1755468229,
    "claimed": true  // This causes routing to skip unclaimed queue
  }
}
```

### Root Cause
The rate-limited-claim-lambda is writing to the container-ownership table when it should only be checking if an entry exists. It's acting like a container instead of a gatekeeper.

### Impact
- When `claimed: true`, CheckIfClaimed routes to ProcessAttachments
- SendToUnclaimedQueue is never reached
- Messages go directly to project+user FIFO queue
- Container never receives claim requests
- 4 messages stuck in `webordinary-input-amelia-scott.fifo`

## What Needs to Be Fixed

### 1. Fix rate-limited-claim-lambda
The Lambda should:
- CHECK if project+user is claimed (read-only)
- Return `claimed: false` if no container owns it
- Return `claimed: true` + containerId if owned
- NEVER write to the container-ownership table

### 2. Correct Logic Flow
```
CheckActiveJob → ClaimJob (check only) → CheckIfClaimed:
  - If claimed=true → ProcessAttachments → SendToContainer (direct)
  - If claimed=false → SendToUnclaimedQueue (parallel):
    - Branch 1: SendToContainer (FIFO queue)
    - Branch 2: SendClaimRequest (unclaimed queue)
```

### 3. Container Claiming
Only containers should write to container-ownership table when they:
- Receive CLAIM_REQUEST from unclaimed queue
- Successfully perform atomic DynamoDB put with conditional expression

## Files Modified in This Session

### Created
- `/scripts/test-aws-email.sh` - AWS email testing script
- `/claude-code-container/src/services/generic-container.service.ts` - Generic container service

### Modified
- `/hephaestus/lib/stepfunctions/email-processor.asl.json` - Added routing logic
- `/hephaestus/lib/sqs-stack.ts` - Removed duplicate resources
- `/claude-code-container/src/app.module.ts` - Use unclaimed queue
- `/claude-code-container/src/main.ts` - Generic startup
- `/claude-code-container/src/services/git.service.ts` - Removed queue-manager deps
- `/claude-code-container/src/services/s3-sync.service.ts` - Removed queue-manager deps

### Deleted
- `/claude-code-container/src/services/queue-manager.service.ts` - Not needed

## Current State

### What's Working
- Step Functions execution starts correctly from S3 events
- Container polls unclaimed queue successfully
- Infrastructure deployed and accessible

### What's Not Working
- rate-limited-claim-lambda incorrectly claims ownership
- Messages stuck in FIFO queue with no container processing them
- Unclaimed queue remains empty (0 messages)

## Next Steps for Resolution

### Immediate Fix Required
1. Fix `/hephaestus/lambdas/rate-limited-claim-lambda/index.ts`:
   - Change from PutItem to GetItem
   - Return claim status without modifying table
   - Only containers should claim

### Testing After Fix
1. Deploy fixed Lambda
2. Clear stuck messages from FIFO queue
3. Send new test email
4. Verify unclaimed queue receives CLAIM_REQUEST
5. Confirm container claims and processes

### Additional Improvements
1. Add CloudWatch metrics for claim attempts
2. Add DLQ for unclaimed queue
3. Consider claim expiration logic
4. Add container health checks

## Key Learnings

1. **Lambda vs Container Responsibilities**: Clear separation needed - Lambdas check state, containers perform actions
2. **ASL Routing Complexity**: The parallel state for unclaimed routing works but needs correct upstream conditions
3. **Testing Importance**: Real AWS testing revealed issues LocalStack wouldn't catch
4. **Queue Visibility**: 4 stuck messages show the importance of monitoring and alerting

## Commands for Debugging

```bash
# Check unclaimed queue
AWS_PROFILE=personal aws sqs get-queue-attributes \
  --queue-url https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed \
  --attribute-names ApproximateNumberOfMessages

# Check FIFO queue
AWS_PROFILE=personal aws sqs get-queue-attributes \
  --queue-url https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-input-amelia-scott.fifo \
  --attribute-names ApproximateNumberOfMessages

# Check ownership table
AWS_PROFILE=personal aws dynamodb scan \
  --table-name webordinary-container-ownership

# Monitor Step Functions
AWS_PROFILE=personal aws stepfunctions list-executions \
  --state-machine-arn arn:aws:states:us-west-2:942734823970:stateMachine:email-processor \
  --max-items 5
```

## Conclusion

The unclaimed queue pattern implementation is mostly complete but has a critical bug in the rate-limited-claim-lambda that prevents it from working. Once this Lambda is fixed to only CHECK claims rather than CREATE them, the pattern should work as designed. The container is ready and waiting to process claim requests once they start flowing to the unclaimed queue.