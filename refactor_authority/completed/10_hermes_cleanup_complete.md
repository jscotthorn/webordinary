# Hermes Cleanup from Container Complete

## Date: 2025-08-17

## Summary
Successfully removed all Hermes-specific code from the claude-code-container, completing the transition to Step Functions architecture.

## Files Deleted (Hermes-specific)

### 1. **queue-manager.service.ts** ❌
- Contained Hermes-specific unclaimed queue polling logic
- Project claiming mechanism (no longer needed)
- Output queue handling (replaced by Step Functions callbacks)
- Container ownership tracking via DynamoDB

### 2. **message-processor.service.ts** ❌
- Old Hermes message handling logic
- Response queue sending
- Replaced entirely by message-processor-v2.service.ts

### 3. **thread-manager.ts** ❌
- Complex client/user/thread workspace management
- Replaced by simpler project+user branch management in v2

### 4. **app.module.v2.ts** ❌
- Temporary duplicate module
- Content moved to main app.module.ts

## Files Updated

### 1. **app.module.ts** ✅
- Replaced with Step Functions-aware module configuration
- Includes new services: StepFunctionsCallback, ActiveJob, VisibilityExtension, InterruptHandler
- Uses MessageProcessorV2 instead of old MessageProcessor
- Removed all Hermes service dependencies

### 2. **main.ts** ✅
- Simplified bootstrap process
- Removed Hermes initialization logic
- Removed queue manager setup
- Added Step Functions integration logging
- Clean, minimal startup

### 3. **types/queue-messages.ts** ✅
- Removed Hermes message types (ClaimRequest, Work, Response)
- Added Step Functions types (StepFunctionMessage, StepFunctionResponse)
- Added InterruptMessage type
- Added ActiveJob type for DynamoDB

## Architecture Changes

### Before (Hermes)
```
Email → SES → Hermes → Container → Output Queue → Hermes → S3
                ↑                           ↓
          Unclaimed Queue              Response Queue
```

### After (Step Functions)
```
Email → SES → S3 → Lambda → Step Functions → Container → S3
                                    ↑              ↓
                                    └──Callbacks───┘
```

## Key Improvements

1. **Direct Callbacks**: No output queue needed - containers callback directly to Step Functions
2. **Simplified Claiming**: No unclaimed queue - Step Functions routes directly to project+user queues
3. **Better Interrupts**: Separate Standard queue for interrupts bypasses FIFO blocking
4. **Cleaner Types**: Message types now match Step Functions integration exactly
5. **Reduced Complexity**: Removed ~1000 lines of Hermes-specific code

## Services Retained (Core Functionality)

1. **ClaudeExecutorService** - Core Claude Code execution
2. **GitService** - Git operations
3. **S3SyncService** - S3 deployment
4. **CommitMessageService** - Commit message generation

## New Services (Step Functions Integration)

1. **StepFunctionsCallbackService** - Manages callbacks and heartbeats
2. **ActiveJobService** - DynamoDB job tracking
3. **VisibilityExtensionService** - SQS visibility timeout management
4. **InterruptHandlerService** - Handles interruptions
5. **MessageProcessorV2** - New message processor for Step Functions

## Environment Variables

### Removed
- `UNCLAIMED_QUEUE_URL` - No longer needed
- `OWNERSHIP_TABLE_NAME` - No claiming mechanism

### Required
- `PROJECT_ID` - Project identifier (e.g., 'amelia')
- `USER_ID` - User identifier (e.g., 'scott')
- `ACTIVE_JOBS_TABLE` - DynamoDB table for job tracking
- `AWS_REGION` - AWS region
- `AWS_ACCOUNT_ID` - AWS account ID
- `WORKSPACE_PATH` - Container workspace
- `GITHUB_TOKEN` - GitHub access token

### Optional
- `CONTAINER_ID` - Auto-generated if not provided
- `GIT_PUSH_ENABLED` - Enable/disable git push

## Testing Impact

Container can now be tested with:
1. Direct Step Functions execution
2. Mock task tokens for local testing
3. Simplified message format
4. No need to simulate Hermes responses

## Next Steps

1. Build and test container with new configuration
2. Deploy to ECS with updated environment variables
3. Test end-to-end flow with Step Functions
4. Monitor CloudWatch for proper callback execution
5. Verify interrupt handling with rapid emails

## Conclusion

The Hermes cleanup is complete. The container is now fully integrated with Step Functions, using direct callbacks instead of output queues. All Hermes-specific code has been removed, resulting in a cleaner, more maintainable codebase that aligns with the new serverless architecture.