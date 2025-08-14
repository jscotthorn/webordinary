# Local Development Guide

## Quick Start

```bash
# Start services
./scripts/start-local-dev.sh

# Send test email
./scripts/send-test-email.sh

# Check status
./scripts/check-local-status.sh

# Monitor logs
docker logs -f hermes-manual
docker logs -f claude-manual
```

## Critical Configuration

### 1. Environment Variables

#### hermes/.env.local
```bash
# Must have AWS credentials
AWS_PROFILE=personal
AWS_REGION=us-west-2

# Project configuration (in message-router.service.ts)
# Update repoUrl to: https://github.com/jscotthorn/amelia-astro.git
```

#### claude-code-container/.env.local
```bash
# CRITICAL: Must be /workspace not /workspace/amelia-astro
WORKSPACE_PATH=/workspace

# GitHub token for pushing branches
GITHUB_TOKEN=your_github_pat_token

# AWS
AWS_PROFILE=personal
AWS_REGION=us-west-2
```

### 2. Code Fixes Required

#### Fix 1: Repository URL (hermes/src/modules/message-processor/message-router.service.ts)
```typescript
// Line 47 - Update to correct GitHub repo
repoUrl: 'https://github.com/jscotthorn/amelia-astro.git',
```

#### Fix 2: Claim Parsing (claude-code-container/src/services/queue-manager.service.ts)
```typescript
// Line 390 - Split on '#' not '-'
const [projectId, userId] = this.currentProjectKey.split('#');
```

#### Fix 3: AWS CLI Multi-arch (claude-code-container/Dockerfile)
```dockerfile
# Lines 32-41 - Support ARM64 Macs
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then \
        curl "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "awscliv2.zip"; \
    else \
        curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"; \
    fi && \
    unzip awscliv2.zip && \
    ./aws/install && \
    rm -rf awscliv2.zip aws/
```

#### Fix 4: MJML Import (hermes/src/modules/email-processor/email-processor.service.ts)
```typescript
// Line 6 - Use CommonJS require
const mjml2html = require('mjml');
```

#### Fix 5: Branch Name Duplication (claude-code-container/src/message-processor.service.ts)
```typescript
// Line 194 - Check if thread- prefix exists
const branch = chatThreadId.startsWith('thread-') ? chatThreadId : `thread-${chatThreadId}`;
```

#### Fix 6: Claude Simulation Path (claude-code-container/src/services/claude-executor.service.ts)
```typescript
// Lines 30-34 - Use project path from context
const projectPath = context?.projectPath || this.workspacePath;
const testFilePath = path.join(projectPath, 'test-page.html');

// Lines 53-59 - Return filesChanged array
return {
  success: true,
  output: `Simulated: ${instruction}`,
  summary: 'Test file created successfully',
  filesChanged: ['test-page.html']
};
```

#### Fix 7: Pass Project Path to Claude (claude-code-container/src/message-processor.service.ts)
```typescript
// Lines 231-238 - Add project path to context
const projectPath = this.getProjectPath();
const contextWithPath = {
  ...message.context,
  projectPath
};
const result = await this.claudeExecutor.execute(
  message.instruction,
  contextWithPath
);
```

## Common Issues and Solutions

### Docker Build Cache Issues
```bash
# Clear cache and rebuild
./scripts/start-local-dev.sh --clean
```

### Containers Won't Start
```bash
# Nuclear option - clear everything
docker stop hermes-manual claude-manual
docker rm hermes-manual claude-manual
docker buildx prune -af
./scripts/start-local-dev.sh
```

### Hermes Socket Errors
```bash
# Restart Hermes
docker restart hermes-manual
```

### Git Push Failures
- Verify GitHub token in claude-code-container/.env.local
- Check repository exists: https://github.com/jscotthorn/amelia-astro
- Ensure branch doesn't already exist on GitHub

### No Commits Being Made
- Check WORKSPACE_PATH is `/workspace` not `/workspace/amelia-astro`
- Verify Claude simulation is returning filesChanged array
- Check git operations are using correct project path

## Testing Workflow

1. **Start Services**
   ```bash
   ./scripts/start-local-dev.sh
   ```

2. **Send Test Email**
   ```bash
   ./scripts/send-test-email.sh
   ```

3. **Monitor Processing**
   ```bash
   # Watch logs
   docker logs -f claude-manual
   
   # Check for key events:
   # - "Successfully claimed ameliastamps#scott"
   # - "Cloned repository from https://github.com/jscotthorn/amelia-astro.git"
   # - "Created test file: /workspace/ameliastamps/scott/amelia-astro/test-page.html"
   # - "Committed: Change..."
   # - "Pushed branch thread-... successfully"
   ```

4. **Verify on GitHub**
   ```bash
   # Check branches
   git ls-remote https://github.com/jscotthorn/amelia-astro.git | grep thread
   
   # Clone and verify
   git clone -b thread-<branch-name> https://github.com/jscotthorn/amelia-astro.git /tmp/verify
   ls -la /tmp/verify/test-page.html
   ```

## Architecture Flow

```
1. Email → SQS (webordinary-email-queue)
2. Hermes picks up from SQS
3. Hermes identifies project/user (ameliastamps/scott)
4. Hermes sends to unclaimed queue
5. Container claims project
6. Container polls project queue (webordinary-input-ameliastamps-scott)
7. Container processes message:
   - Clones repo from GitHub
   - Creates branch (thread-...)
   - Runs Claude simulation
   - Creates test file
   - Commits changes
   - Pushes to GitHub
8. Container sends response to output queue
```

## Key Paths and Queues

- **Workspace**: `/workspace/ameliastamps/scott/amelia-astro/`
- **Unclaimed Queue**: `webordinary-unclaimed`
- **Input Queue**: `webordinary-input-ameliastamps-scott`
- **Output Queue**: `webordinary-output-ameliastamps-scott`
- **GitHub Repo**: `https://github.com/jscotthorn/amelia-astro.git`
- **S3 Bucket**: `edit.amelia.webordinary.com` (for production)

## Required AWS Resources

All resources should exist in `us-west-2` region with `personal` profile:

- SQS Queues:
  - webordinary-email-queue
  - webordinary-unclaimed
  - webordinary-input-ameliastamps-scott
  - webordinary-output-ameliastamps-scott
  
- DynamoDB Tables:
  - webordinary-thread-mappings
  - webordinary-container-ownership
  
- S3 Buckets:
  - edit.amelia.webordinary.com (optional for local)