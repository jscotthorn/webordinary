# Container Lifecycle Architecture Confusion

## Problem Summary

The container lifecycle has fundamentally changed but code still expects the old pattern where containers were pre-configured for specific project+user combinations with git repo URLs passed as environment variables.

## Old Architecture (Defunct)

### How It Used To Work
1. **Container Creation**: Spun up with specific project+user binding
2. **Environment Variables**: 
   - `GIT_REPO_URL` passed at container start
   - `PROJECT_ID` fixed for container lifetime
   - `USER_ID` fixed for container lifetime
3. **Lifecycle**: 
   - Auto-scale to 0 when idle
   - Remain "assigned" to project+user
   - Spin back up for same project+user
4. **One Container = One Project+User**: Permanent assignment

### Example Old Environment
```bash
# Container started with:
GIT_REPO_URL=https://github.com/jscotthorn/amelia-astro.git
PROJECT_ID=amelia
USER_ID=escottster@gmail.com
CLIENT_ID=amelia  # Fixed at startup
```

## New Architecture (Current)

### How It Should Work Now
1. **Container Creation**: Generic warm pools
2. **Dynamic Claims**: Container claims project+user from unclaimed queue
3. **Git Repo**: Passed in message, not environment
4. **Lifecycle**:
   - Containers stay warm
   - Claim different project+user combinations
   - Release claims when done
5. **One Container = Many Project+Users**: Dynamic assignment

### Example New Message
```json
{
  "type": "work",
  "projectId": "amelia",
  "userId": "escottster@gmail.com",
  "repoUrl": "https://github.com/jscotthorn/amelia-astro.git",
  "instruction": "Update the homepage"
}
```

## Current Problems

### 1. Environment Variable Confusion
**Issue**: Code still looking for `GIT_REPO_URL` in environment
**Impact**: Containers fail to process messages
**Evidence**: Errors about missing repo URL

### 2. Container Identity Crisis
**Issue**: Containers think they're permanently bound to project+user
**Impact**: Won't claim new work from unclaimed queue
**Evidence**: Containers sitting idle instead of claiming

### 3. Scaling Behavior
**Issue**: Infrastructure still trying to scale per project+user
**Impact**: Inefficient resource usage
**Evidence**: Multiple idle containers instead of shared pool

## Files Needing Cleanup

### Environment Files to Audit
```bash
# Find all env files
find . -name ".env*" -o -name "*.env" | grep -v node_modules

# Likely locations:
claude-code-container/.env
claude-code-container/.env.local
claude-code-container/.env.example
claude-code-container/.env.local.example
hermes/.env
hermes/.env.local
hermes/.env.example
hermes/.env.local.example
hephaestus/.env
```

### Environment Variables to Remove
```bash
# REMOVE these from all .env files:
GIT_REPO_URL          # Now in message
FIXED_PROJECT_ID      # Now dynamic
FIXED_USER_ID         # Now dynamic
AUTO_SCALE_TO_ZERO    # No longer relevant
CONTAINER_ASSIGNMENT  # Not a thing anymore

# KEEP these:
AWS_PROFILE
AWS_REGION
ANTHROPIC_API_KEY
S3_BUCKET_PREFIX     # For S3 deployment
UNCLAIMED_QUEUE_URL  # For claiming work
```

### Code Patterns to Fix

#### Old Pattern (Remove)
```typescript
// Getting repo from environment
const repoUrl = process.env.GIT_REPO_URL;
if (!repoUrl) {
  throw new Error('GIT_REPO_URL not set');
}

// Fixed project binding
this.projectId = process.env.PROJECT_ID;
this.userId = process.env.USER_ID;
```

#### New Pattern (Implement)
```typescript
// Getting repo from message
const repoUrl = message.repoUrl;
if (!repoUrl) {
  throw new Error('repoUrl not in message');
}

// Dynamic project binding
async claimWork(message: WorkMessage) {
  this.currentProject = message.projectId;
  this.currentUser = message.userId;
  this.currentRepo = message.repoUrl;
}
```

## CDK/Infrastructure Changes Needed

### Remove from Task Definitions
```typescript
// OLD - Remove this
environment: [
  { name: 'GIT_REPO_URL', value: 'https://github.com/...' },
  { name: 'PROJECT_ID', value: 'amelia' },
  { name: 'USER_ID', value: 'escottster@gmail.com' }
]

// NEW - Generic containers
environment: [
  { name: 'UNCLAIMED_QUEUE_URL', value: queueUrl },
  { name: 'AWS_REGION', value: 'us-west-2' }
]
```

### Update Auto-Scaling
```typescript
// OLD - Scale per project+user
scalingPolicy: {
  targetValue: 1, // One container per active project+user
  scaleInCooldown: Duration.minutes(5),
  scaleOutCooldown: Duration.seconds(30)
}

// NEW - Scale based on queue depth
scalingPolicy: {
  targetValue: 10, // Messages per container
  metric: CloudWatchMetric.queueDepth('unclaimed-queue'),
  scaleInCooldown: Duration.minutes(10),
  scaleOutCooldown: Duration.minutes(1)
}
```

## Testing After Changes

### 1. Container Startup Test
```bash
# Container should start without GIT_REPO_URL
docker run webordinary/claude-code-container
# Should not error about missing repo
```

### 2. Message Processing Test
```json
// Send test message with repo URL
{
  "type": "work",
  "repoUrl": "https://github.com/test/repo.git",
  "projectId": "test",
  "userId": "test@example.com",
  "instruction": "test"
}
```

### 3. Multi-Claim Test
1. Start one container
2. Send work for project A
3. Container processes and releases
4. Send work for project B
5. Same container should claim and process

## Migration Checklist

### Phase 1: Environment Cleanup
- [ ] Audit all .env files
- [ ] Remove GIT_REPO_URL references
- [ ] Remove fixed project/user bindings
- [ ] Update .env.example files
- [ ] Document required vs optional env vars

### Phase 2: Code Updates
- [ ] Update message processor to get repo from message
- [ ] Remove environment repo checks
- [ ] Implement dynamic claiming logic
- [ ] Update error messages
- [ ] Fix health checks

### Phase 3: Infrastructure
- [ ] Update CDK task definitions
- [ ] Fix auto-scaling policies
- [ ] Remove per-project+user scaling
- [ ] Implement queue-based scaling

### Phase 4: Testing
- [ ] Test container without repo URL
- [ ] Test dynamic claiming
- [ ] Test multiple project+users per container
- [ ] Verify scaling behavior

## Documentation Updates Needed

1. **README files**: Remove references to env-based repo
2. **CLAUDE.md files**: Update quick start guides
3. **Deployment docs**: Remove per-project+user setup
4. **Local dev docs**: Use messages, not env vars

## Success Criteria

1. Containers start without GIT_REPO_URL
2. Repo URL comes from messages
3. One container can handle multiple project+users
4. No errors about missing environment variables
5. Documentation reflects dynamic claiming model