# Task 01: Add Push After Commits

## Objective
Enhance the existing git workflow to push commits to remote after auto-commits and Claude operations.

## Context
The container already auto-commits changes when interrupted or switching sessions, but these commits stay local. We need to push them to preserve work.

## Current Code Analysis
From `MessageProcessor`:
- Line 120: `await this.gitService.autoCommitChanges('Interrupted by new message');`
- Line 131: `await this.gitService.autoCommitChanges('Switching sessions');`

From `GitService`:
- `autoCommitChanges()` commits but doesn't push
- `push()` method exists but isn't called

## Implementation

### 1. Update GitService.autoCommitChanges
```typescript
// In git.service.ts, modify autoCommitChanges method:

async autoCommitChanges(message: string, pushAfter: boolean = true): Promise<void> {
  try {
    // Check if there are changes to commit
    const { stdout: status } = await execAsync('git status --porcelain', { 
      cwd: this.workspacePath 
    });
    
    if (!status.trim()) {
      this.logger.debug('No changes to commit');
      return;
    }

    // Stage all changes
    await execAsync('git add -A', { cwd: this.workspacePath });
    
    // Commit with message
    await execAsync(`git commit -m "Auto-save: ${message}"`, { 
      cwd: this.workspacePath 
    });
    
    this.logger.log(`Auto-committed changes: ${message}`);
    
    // NEW: Push to remote if requested
    if (pushAfter) {
      try {
        await this.push();
        this.logger.log('Pushed auto-commit to remote');
      } catch (pushError: any) {
        this.logger.warn(`Failed to push auto-commit: ${pushError.message}`);
        // Don't throw - push failure shouldn't break workflow
      }
    }
  } catch (error: any) {
    this.logger.warn(`Auto-commit failed: ${error.message}`);
    // Non-fatal error, continue processing
  }
}
```

### 2. Add Explicit Push After Claude Operations
```typescript
// In message-processor.service.ts, after successful Claude execution:

private async executeAndCommit(message: any): Promise<any> {
  try {
    // Execute Claude Code
    const result = await this.executeClaudeCode(message);
    
    // Commit changes made by Claude
    const commitMessage = this.extractCommitMessage(message);
    await this.gitService.autoCommitChanges(commitMessage, false); // Don't push yet
    
    // Build and deploy to S3 (Task 02)
    // ...
    
    // Push all commits after successful build/deploy
    await this.gitService.push();
    
    return result;
  } catch (error) {
    this.logger.error('Execute and commit failed:', error);
    throw error;
  }
}

private extractCommitMessage(message: any): string {
  // Use instruction or command as commit message
  const instruction = message.instruction || message.command || 'Claude changes';
  const sessionId = message.sessionId?.substring(0, 8) || 'unknown';
  return `[${sessionId}] ${instruction.substring(0, 100)}`;
}
```

### 3. Handle Push Failures Gracefully
```typescript
// Add retry logic to git.service.ts:

async pushWithRetry(maxRetries: number = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await this.push();
      return true;
    } catch (error: any) {
      this.logger.warn(`Push attempt ${attempt} failed: ${error.message}`);
      
      if (attempt === maxRetries) {
        this.logger.error('All push attempts failed');
        return false;
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
  return false;
}
```

### 4. Add GitHub Token Configuration
Ensure the container has GitHub credentials:
```typescript
// In git.service.ts constructor or init:

async configureGitCredentials(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    this.logger.warn('No GITHUB_TOKEN found, push may fail');
    return;
  }
  
  // Configure git to use token
  await execAsync(`git config --global credential.helper store`);
  await execAsync(`git config --global user.email "container@webordinary.com"`);
  await execAsync(`git config --global user.name "WebOrdinary Container"`);
}
```

## Testing

### Local Testing
```bash
# In container
docker run -it \
  -e GITHUB_TOKEN=${GITHUB_TOKEN} \
  -v /workspace:/workspace \
  claude-container-local

# Send test message that makes changes
# Verify commits are pushed to GitHub
```

### Test Scenarios
1. **Normal flow**: Change → Commit → Push succeeds
2. **No changes**: No commit, no push
3. **Push failure**: Commit succeeds, push retries
4. **Interrupt**: Auto-commit and push before switching
5. **No token**: Commit works, push fails gracefully

## Acceptance Criteria
- [ ] Auto-commits are followed by push
- [ ] Push failures don't break workflow
- [ ] Commit messages are descriptive
- [ ] GitHub token properly configured
- [ ] Retry logic for transient failures

## Configuration
Add to container environment:
```yaml
GITHUB_TOKEN: ${GITHUB_TOKEN}
GIT_PUSH_ENABLED: "true"  # Feature flag
GIT_PUSH_RETRY_COUNT: "3"
```

## Time Estimate
1-2 hours

## Notes
- Push failures shouldn't be fatal
- Consider queuing failed pushes for later
- Monitor GitHub API rate limits
- Test with both SSH and HTTPS git URLs