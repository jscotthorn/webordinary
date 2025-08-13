# Environment Variables Audit & Cleanup Checklist

## Critical Finding: REPO_URL Still Being Used

### Files with REPO_URL References
```
✗ claude-code-container/src/main.ts:25 - process.env.REPO_URL
✗ claude-code-container/dist/main.js - process.env.REPO_URL
✗ claude-code-container/dist/index.js - process.env.REPO_URL
✗ hephaestus/lib/fargate-stack.ts - hardcoded in task definition
✗ hermes/src/modules/edit-session/services/fargate-manager.service.ts - passes REPO_URL
✗ hermes/src/modules/container/container-manager.service.ts - passes REPO_URL
```

## Environment Files Status

### claude-code-container/.env.local.example
**Status**: Needs Updates
- ❌ Remove: `CLIENT_ID=amelia` (should be dynamic from message)
- ❌ Remove: `DEFAULT_CLIENT_ID=amelia` (no defaults)
- ❌ Remove: `DEFAULT_USER_ID=scott` (no defaults)
- ❌ Remove: `AUTO_SHUTDOWN_MINUTES=30` (containers stay warm)
- ⚠️ Rename: `CLIENT_ID` → `PROJECT_ID` (terminology)
- ⚠️ Question: `WORKSPACE_PATH=/workspace/amelia-astro` (should be dynamic?)
- ✅ Keep: AWS configuration
- ✅ Keep: S3_BUCKET_NAME (though this might be dynamic too)
- ✅ Keep: GITHUB_TOKEN
- ✅ Keep: ANTHROPIC_API_KEY

### hermes/.env.local.example  
**Status**: Needs Minor Updates
- ❌ Remove: `CLAUDE_CODE_CONTAINER_URL=http://localhost:8080` (no HTTP)
- ⚠️ Question: `WORKSPACE_PATH=/workspace/amelia-astro` (why here?)
- ✅ Keep: Queue and table names
- ✅ Keep: AWS configuration
- ✅ Keep: Bedrock configuration

### hephaestus/.env
**Status**: Check for legacy patterns
- Need to review this file

## Variables to Remove Globally

### Definitely Remove
```bash
REPO_URL              # Must come from message
GIT_REPO_URL         # Old name for REPO_URL
FIXED_PROJECT_ID     # Dynamic from message
FIXED_USER_ID        # Dynamic from message
CLIENT_ID            # Use PROJECT_ID, and dynamic
DEFAULT_CLIENT_ID    # No defaults
DEFAULT_USER_ID      # No defaults
AUTO_SHUTDOWN_MINUTES # Containers stay warm
CLAUDE_CODE_CONTAINER_URL # No HTTP communication
```

### Variables to Add/Keep
```bash
# Required for containers
UNCLAIMED_QUEUE_URL  # For monitoring unclaimed work
AWS_PROFILE          # For credentials
AWS_REGION           # For services
ANTHROPIC_API_KEY    # For Claude
GITHUB_TOKEN         # For git operations

# Required for Hermes
EMAIL_QUEUE_NAME     # Incoming emails
UNCLAIMED_QUEUE_NAME # Available work
[Table names...]     # DynamoDB tables
```

## Code Changes Required

### claude-code-container/src/main.ts
```typescript
// REMOVE lines 25-34
const repoUrl = process.env.REPO_URL;
if (repoUrl) {
  logger.log(`Initializing repository from ${repoUrl}`);
  try {
    await gitService.initRepository(repoUrl);
  } catch (error: any) {
    logger.error(`Failed to initialize repository: ${error.message}`);
    logger.warn('Continuing without repository - will initialize when needed');
  }
}

// REPLACE WITH
logger.log('Container started - waiting for work claims');
// Repository will be initialized when processing messages
```

### hermes fargate-manager.service.ts
```typescript
// REMOVE
{ name: 'REPO_URL', value: params.repoUrl || 'https://...' }

// Containers get repo from messages, not environment
```

### hephaestus/lib/fargate-stack.ts
```typescript
// REMOVE from task definition environment
REPO_URL: 'https://github.com/jscotthorn/amelia-astro.git',

// Containers are generic, not project-specific
```

## Testing Plan

### 1. Container Startup Without REPO_URL
```bash
# Should start successfully
docker run -e AWS_PROFILE=personal \
  -e UNCLAIMED_QUEUE_URL=... \
  webordinary/claude-code-container

# Should NOT error about missing REPO_URL
```

### 2. Message with Repo URL
```json
{
  "type": "work",
  "repoUrl": "https://github.com/ameliastamps/amelia-astro.git",
  "projectId": "amelia",
  "userId": "escottster@gmail.com",
  "instruction": "test"
}
```

### 3. Environment Variable Validation
```bash
# Check no legacy vars in running container
docker exec [container] env | grep -E "REPO_URL|CLIENT_ID|DEFAULT_"
# Should return nothing
```

## Migration Steps

### Step 1: Update Code (Priority 1)
- [ ] Remove REPO_URL check from claude-code-container/src/main.ts
- [ ] Update message processor to get repo from message
- [ ] Remove REPO_URL from Hermes container spawning
- [ ] Remove REPO_URL from CDK task definitions

### Step 2: Update Environment Files (Priority 2)
- [ ] Update claude-code-container/.env.local.example
- [ ] Update hermes/.env.local.example
- [ ] Check and update hephaestus/.env
- [ ] Create migration guide for developers

### Step 3: Update Documentation (Priority 3)
- [ ] Update README files
- [ ] Update CLAUDE.md quick references
- [ ] Document required vs optional variables
- [ ] Add troubleshooting for missing repo errors

### Step 4: Test and Deploy (Priority 4)
- [ ] Test containers without REPO_URL
- [ ] Test message processing with repo in message
- [ ] Deploy updated containers
- [ ] Monitor for errors

## Common Errors After Migration

### Error: "Repository not initialized"
**Cause**: Code expecting repo from environment
**Fix**: Get repo from message and initialize on demand

### Error: "CLIENT_ID not set"
**Cause**: Using old variable name
**Fix**: Use PROJECT_ID from message

### Error: "Cannot determine user"
**Cause**: Expecting DEFAULT_USER_ID
**Fix**: Get userId from message

## Validation Checklist

- [ ] No REPO_URL in any environment files
- [ ] No CLIENT_ID in environment (use PROJECT_ID in messages)
- [ ] No DEFAULT_* variables
- [ ] Containers start without project binding
- [ ] Messages contain all needed info
- [ ] Documentation updated
- [ ] Tests passing