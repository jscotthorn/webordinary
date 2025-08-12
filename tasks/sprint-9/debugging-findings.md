# Message Flow Debugging Findings

## Summary
The message flow has **fundamental architecture mismatches** between Hermes and the Claude container that prevent end-to-end completion.

## ✅ What's Working

1. **Queue Infrastructure**
   - Claude container successfully polls the unclaimed queue
   - Container claims projects when receiving `claim_request` messages
   - Ownership is recorded in DynamoDB (`webordinary-container-ownership`)
   - Container switches to polling project-specific queue after claiming

2. **Message Reception**
   - Container receives messages from the project input queue
   - Message processor starts processing the instruction
   - Logging shows correct session and instruction extraction

3. **AWS Integration**
   - AWS SDK works correctly in the container
   - SQS operations (receive, delete) function properly
   - DynamoDB operations (put, update) work correctly

## ❌ Issues Found

### 1. ECS Service Competition
**Problem**: Production ECS service was running and consuming messages  
**Solution**: Scaled down `webordinary-edit-service` to 0 instances  
**Impact**: Messages were being consumed before local container could process them

### 2. Message Format Mismatch
**Problem**: Complete disconnect between what Hermes sends and what Claude container expects

**What Claude Container Expects**:
- For claiming: `type: "claim_request"` with `projectId` and `userId`
- For work: Message with `repoUrl` field for repository initialization

**What Hermes Actually Sends** (from DLQ analysis):
```json
{
  "sessionId": "test-local-dev",
  "projectId": "ameliastamps",
  "userId": "scott",
  "from": "escottster@gmail.com",
  "subject": "Test Local Development",
  "body": "Please create a test page...",
  "instruction": "Create a simple HTML page...",
  "threadId": "thread-local-test",
  "timestamp": "2025-08-12T13:15:00Z"
}
```
**Missing**: `type` field and `repoUrl` field

### 3. Repository Initialization Design Flaw
**Problem**: Repository URL not passed in messages  
**Root Cause**: 
- Claude container has code to clone repositories (`GitService.initRepository()`)
- Message processor was updated to handle `repoUrl` from messages
- But Hermes never sends `repoUrl` in messages
- The old `REPO_URL` environment variable is a global setting (wrong for multi-project)

**Code Evidence**:
- Hermes has `getRepoUrl()` method with hardcoded mapping
- Hermes uses repo URL for Fargate task environment variables
- But when sending to queues, repo URL is not included

**Impact**: Container can't clone the correct repository for each project

### 4. Shell Spawn Error (False Positive)
**Initial Error**: `spawn /bin/sh ENOENT`  
**Investigation**: `/bin/sh` exists and works when tested directly  
**Real Cause**: Git commands failing due to missing repository, not shell issues

### 5. AWS CLI Missing
**Problem**: AWS CLI not installed in container  
**Impact**: S3 sync operations cannot work  
**Code Evidence**: `S3SyncService` uses `execAsync('aws s3 sync ...')`
**Workaround Needed**: Either install AWS CLI in Docker image OR refactor to use AWS SDK

### 6. Message Processing Implementation Issue
**Problem**: `executeClaudeCode()` tries to spawn non-existent process
**Code Evidence**:
```typescript
// message-processor.service.ts line 195
this.currentProcess = spawn('claude-code', [...])
```
**Issue**: There is no `claude-code` CLI binary - should use `ClaudeExecutorService` instead

## 📊 Message Flow Trace

### Current Flow (What Actually Happens)
1. **Email → Hermes**
   - Email received by SES → Sent to email queue → Hermes picks up
   - ✅ Working

2. **Hermes → Queues**
   - Hermes tries to start Fargate task (old approach)
   - Should send to queues but still using old architecture
   - ❌ Not working correctly

3. **Unclaimed Queue**
   - Container expects `type: "claim_request"` messages
   - Hermes doesn't send this format
   - Manual test messages work
   - ⚠️ Works with correct format only

4. **Project Queue → Container**
   - Container receives message
   - Tries to initialize repository but no `repoUrl`
   - Tries to switch git branch but no repository exists
   - Tries to execute `claude-code` binary that doesn't exist
   - ❌ Multiple failures

5. **Container → S3**
   - Never reached due to earlier failures
   - Would fail anyway due to missing AWS CLI
   - ❌ Not working

### Expected Flow (What Should Happen)
1. Email → Hermes → Parse instruction
2. Hermes → Send to project queue AND unclaimed queue (if no container)
3. Container claims from unclaimed queue
4. Container polls project queue
5. Container receives message with `repoUrl`
6. Container clones/updates repository
7. Container processes with Claude API
8. Container builds Astro project
9. Container syncs to S3
10. Container sends response to output queue

## 🔧 Required Fixes

### Critical Architecture Fixes

#### 1. Hermes Message Router Integration
**Location**: `hermes/src/modules/email-processor/email-processor.service.ts`
- Replace `EditSessionService` with `MessageRouterService`
- Include `repoUrl` in message payload
- Send proper claim requests to unclaimed queue

#### 2. Message Format Standardization
**Both Hermes and Claude Container**
- Define standard message interface with required fields:
  ```typescript
  interface QueueMessage {
    type?: 'claim_request' | 'work';
    sessionId: string;
    projectId: string;
    userId: string;
    repoUrl?: string;  // Required for work messages
    instruction?: string;
    // ... other fields
  }
  ```

#### 3. Claude Container Message Processing
**Location**: `claude-code-container/src/message-processor.service.ts`
- Fix `executeClaudeCode()` to use `ClaudeExecutorService`
- Remove `spawn('claude-code', ...)` calls
- Ensure repository initialization happens before git operations

#### 4. AWS CLI Installation
**Location**: `claude-code-container/Dockerfile`
- Add AWS CLI installation:
  ```dockerfile
  RUN apt-get update && apt-get install -y awscli
  ```
- OR refactor `S3SyncService` to use AWS SDK

### Implementation Priority
1. **Fix Hermes routing** (most critical - nothing works without this)
2. **Standardize message format** (needed for components to communicate)
3. **Fix Claude execution** (needed for actual processing)
4. **Add AWS CLI** (needed for S3 deployment)

## 💡 Key Discoveries

1. **Architecture Mismatch**: Hermes and Claude container were developed separately with incompatible assumptions
2. **Message Format Never Defined**: No shared interface/contract between services
3. **Repository Management Unclear**: No clear strategy for multi-project repository handling
4. **Queue System Works**: The underlying queue infrastructure is solid
5. **Container Can Claim Projects**: The ownership model works when messages are correct

## 🚨 Critical Insights

### The Fundamental Problem
The system has **two separate architectures** running simultaneously:
1. **Old**: Hermes → Fargate Tasks (with environment variables)
2. **New**: Hermes → Queues → Containers (with messages)

These were never fully integrated. Hermes still tries to start Fargate tasks while the Claude container expects queue messages with different formats.

### Why It Doesn't Work
1. **Hermes** was built for Fargate task management
2. **Claude Container** was built for queue-based processing
3. **Message formats** were never standardized between them
4. **Repository URLs** are handled via environment variables (Fargate) not messages (queues)
5. **The refactor was incomplete** - old code remains active

## 📈 Effort Estimate

To make the system fully functional:
- **Hermes Refactor**: 4-6 hours (remove Fargate, implement proper queue routing)
- **Message Standardization**: 2-3 hours (define interfaces, update both services)
- **Claude Container Fixes**: 3-4 hours (fix execution, handle repos properly)
- **Testing & Debugging**: 4-6 hours (end-to-end validation)

**Total**: 2-3 days of focused development

## Conclusion

The local development environment revealed that **the production system is fundamentally broken** due to incomplete migration from Fargate to queue-based architecture. The components work individually but cannot communicate properly due to:

1. **Message format mismatches**
2. **Missing repository URL in messages**
3. **Hermes still using Fargate approach**
4. **Claude container expecting different message structure**

This is not a "local development issue" - it's a **system architecture issue** that affects production as well. The good news is that the queue infrastructure works well, and with proper message formatting and Hermes updates, the system can be made functional.