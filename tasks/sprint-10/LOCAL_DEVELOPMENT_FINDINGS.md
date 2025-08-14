# Local Development Environment - Findings and Recommendations

**Date**: 2025-08-14  
**Author**: Claude Code  
**Status**: Initial Investigation Complete

## Executive Summary

The local development environment for WebOrdinary has been successfully started, but several critical issues prevent end-to-end message flow from email to S3 deployment. The core infrastructure works, but there are configuration and code inconsistencies stemming from an incomplete architectural refactor from Fargate-based to queue-based processing.

## Current State Assessment

### ✅ Working Components

1. **Docker Infrastructure**
   - Both Hermes and Claude containers build and run successfully
   - Health checks pass for Hermes service (http://localhost:3000/hermes/health)
   - Containers can connect to AWS services (SQS, DynamoDB, S3)

2. **Message Queue Infrastructure**
   - SQS queues are accessible and messages can be sent/received
   - Unclaimed queue contains proper claim request messages
   - Basic message routing between services is functional

3. **AWS Integration**
   - AWS credentials properly configured via `AWS_PROFILE=personal`
   - Bedrock access verified for Claude API calls
   - DynamoDB tables accessible (with schema issues noted below)

### ❌ Critical Issues Blocking End-to-End Flow

#### 1. Repository Path Duplication
**Severity**: High  
**Impact**: Prevents Astro builds and git operations

**Problem**: 
- Container looks for repository at: `/workspace/amelia-astro/ameliastamps/scott/amelia-astro/package.json`
- The path contains duplicate `amelia-astro` segments

**Root Cause**:
- Both `GitService.getProjectPath()` and `MessageProcessor.getProjectPath()` append `/amelia-astro`
- When repository is cloned, it creates another `amelia-astro` directory

**Recommendation**:
```typescript
// Fix in GitService.getProjectPath()
private getProjectPath(): string {
  const claim = this.queueManager.getCurrentClaim();
  if (!claim) {
    return `${this.workspacePath}/unclaimed/workspace`;
  }
  const { projectId, userId } = claim;
  // Remove the hardcoded /amelia-astro suffix
  return `${this.workspacePath}/${projectId}/${userId}`;
}
```

#### 2. GitHub Authentication Failure
**Severity**: High  
**Impact**: Cannot push changes to GitHub

**Problem**:
- Error: `fatal: could not read Username for 'https://github.com': No such device or address`

**Root Cause**:
- GitHub token is set in environment but not properly configured for git operations
- Git credential helper not set up correctly for HTTPS authentication

**Recommendation**:
```typescript
// In GitService.configureGitCredentials()
async configureGitCredentials(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is required for git operations');
  }
  
  // Configure git to use token for HTTPS
  await execAsync(`git config --global credential.helper store`);
  await execAsync(`echo "https://${token}:x-oauth-basic@github.com" > ~/.git-credentials`);
  
  // Set user info
  await execAsync(`git config --global user.email "container@webordinary.com"`);
  await execAsync(`git config --global user.name "WebOrdinary Container"`);
}
```

#### 3. Missing Repository URL in Messages
**Severity**: High  
**Impact**: Container cannot clone correct repository

**Problem**:
- Messages from Hermes don't include `repoUrl` field
- Container expects this field to initialize repositories

**Root Cause**:
- Hermes was designed for Fargate tasks (environment variables)
- Message format was never updated for queue-based architecture

**Recommendation**:
```typescript
// In Hermes MessageRouterService
private async routeMessage(message: any) {
  const { projectId, userId } = await this.identifyProjectUser(message);
  
  // Add repository URL to message
  const enrichedMessage = {
    ...message,
    repoUrl: this.getRepoUrlForProject(projectId), // Add this method
    projectId,
    userId,
  };
  
  await this.sendToQueue(enrichedMessage);
}

private getRepoUrlForProject(projectId: string): string {
  const repoMap = {
    'ameliastamps': 'https://github.com/ameliastamps/amelia-astro.git',
    // Add other projects as needed
  };
  return repoMap[projectId] || null;
}
```

#### 4. DynamoDB Schema Mismatch
**Severity**: Medium  
**Impact**: Cannot look up existing sessions

**Problem**:
- Error: `ValidationException: The provided key element does not match the schema`

**Root Cause**:
- Code attempts to query with incorrect key structure
- Session ID format doesn't match table's partition key requirements

**Recommendation**:
- Audit all DynamoDB table schemas
- Update queries to use correct key attributes
- Consider using consistent key naming across all tables

#### 5. SES Email Send Error
**Severity**: Medium  
**Impact**: Cannot send email responses

**Problem**:
- Error: `UnexpectedParameter: Unexpected key 'MessageAttributes' found in params`

**Root Cause**:
- Mixing AWS SDK v2 and v3 patterns
- Using incorrect parameter structure for SES.sendEmail()

**Recommendation**:
```typescript
// Remove MessageAttributes from SES params
const params = {
  Source: 'noreply@webordinary.com',
  Destination: { ToAddresses: [userEmail] },
  Message: {
    Subject: { Data: subject },
    Body: { Html: { Data: htmlBody } }
  }
  // Remove MessageAttributes - not valid for sendEmail
};
```

#### 6. Missing Output Queue Configuration
**Severity**: Low  
**Impact**: Container cannot send processing results

**Problem**:
- Error: `Producer does not exist: container-output`

**Root Cause**:
- Output queue not configured in container environment
- Queue producer not initialized

**Recommendation**:
- Add `OUTPUT_QUEUE_URL` to container environment
- Initialize queue producer in container startup

## Architecture Misalignment Issues

### Incomplete Refactor from Fargate to Queue-Based
The codebase shows evidence of incomplete migration:

1. **Old Pattern (Fargate)**: Environment variables per container for CLIENT_ID, REPO_URL
2. **New Pattern (Queues)**: Dynamic claiming based on message content
3. **Current State**: Mix of both patterns causing confusion

### Message Format Standardization Needed
No consistent message schema between services:

```typescript
// Proposed standard message interface
interface QueueMessage {
  // Message metadata
  messageId: string;
  timestamp: string;
  source: 'email' | 'api' | 'webhook';
  
  // Routing information
  projectId: string;
  userId: string;
  sessionId: string;
  threadId?: string;
  
  // Content
  instruction: string;
  repoUrl?: string;
  
  // Processing directives
  type?: 'claim_request' | 'work' | 'status';
  priority?: 'normal' | 'high';
}
```

## Recommendations Priority List

### Immediate Fixes (Required for Basic Functionality)
1. **Fix repository path duplication** - Update `getProjectPath()` methods
2. **Configure GitHub authentication** - Set up git credentials properly
3. **Add repository URL to messages** - Update Hermes message routing
4. **Fix DynamoDB queries** - Match actual table schemas

### Short-term Improvements (This Week)
1. **Standardize message format** - Create shared TypeScript interfaces
2. **Fix SES email sending** - Remove invalid parameters
3. **Configure output queue** - Add queue producer initialization
4. **Add proper error handling** - Graceful degradation for missing configs

### Medium-term Refactoring (Sprint 11)
1. **Complete architecture migration** - Remove all Fargate-specific code
2. **Implement proper project configuration** - Central registry for project settings
3. **Add integration tests** - Validate end-to-end flow automatically
4. **Improve logging and monitoring** - Better visibility into message flow

## Testing Recommendations

### Local Development Test Suite
Create automated tests for critical paths:

1. **Email Reception Test**
   ```bash
   ./scripts/send-test-email.sh
   # Verify message appears in Hermes logs
   # Verify claim request sent to unclaimed queue
   ```

2. **Container Claiming Test**
   ```bash
   # Send claim request
   # Verify container claims project+user
   # Verify container switches to correct queue
   ```

3. **Git Operations Test**
   ```bash
   # Verify repository clones successfully
   # Verify branch creation/switching works
   # Verify commits and pushes succeed
   ```

4. **Build and Deploy Test**
   ```bash
   # Verify Astro build runs
   # Verify S3 sync executes
   # Verify site accessible at S3 URL
   ```

## Configuration Checklist

### Required Environment Variables

#### Hermes (.env.local)
- [x] AWS_PROFILE=personal
- [x] AWS_REGION=us-west-2
- [x] AWS_ACCOUNT_ID=942734823970
- [ ] Add: PROJECT_REPO_MAP (JSON string or config file)

#### Claude Container (.env.local)
- [x] AWS_PROFILE=personal
- [x] AWS_REGION=us-west-2
- [x] GITHUB_TOKEN
- [x] WORKSPACE_PATH=/workspace
- [ ] Fix: Git credential configuration
- [ ] Add: OUTPUT_QUEUE_URL

## Success Metrics

Once fixed, the system should:
1. Process test email within 30 seconds
2. Successfully claim project+user combination
3. Clone repository and switch to correct branch
4. Process instruction through Claude API
5. Build Astro site successfully
6. Deploy to S3 bucket
7. Send confirmation response

## Conclusion

The local development environment is close to functional but requires several critical fixes to achieve end-to-end message processing. The issues stem primarily from an incomplete architectural refactor and lack of message format standardization. With the fixes outlined above, the system should be fully operational for local development and testing.

## Next Steps

1. Implement immediate fixes (1-2 days)
2. Run end-to-end test with sample email
3. Document successful flow for team reference
4. Create automated test suite
5. Plan Sprint 11 refactoring based on learnings

---

**Note**: This document should be updated as fixes are implemented and new issues are discovered.