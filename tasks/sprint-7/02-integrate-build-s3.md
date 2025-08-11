# Task 02: Integrate Build and S3 Sync

## Objective
Complete the workflow: Claude changes → Commit → Build → S3 sync → Push, ensuring the site updates after every operation.

## Context
We need to integrate the Astro build and S3 sync into the existing message processing flow, maintaining proper sequencing.

## Current Code Analysis
- `AstroService` exists but may need updates
- S3 sync needs to be added (from Sprint 6)
- Must maintain interrupt capability during long operations

## Implementation

### 1. Update Message Processor Flow
```typescript
// In message-processor.service.ts

@SqsMessageHandler('container-input', false)
async handleMessage(message: Message) {
  if (!message.Body) {
    this.logger.error('Received message with no body');
    return;
  }

  const body = JSON.parse(message.Body);
  
  this.autoSleepService.recordActivity('sqs-message');
  this.logger.log(`Received message for session ${body.sessionId}`);
  
  // Interrupt handling (existing)
  if (this.currentProcess) {
    this.logger.warn(`Interrupting current command ${this.currentCommandId}`);
    await this.interruptCurrentProcess();
  }
  
  // Session switching (existing)
  if (body.sessionId !== this.currentSessionId) {
    await this.switchToSession(body.sessionId, body.chatThreadId);
  }
  
  this.currentSessionId = body.sessionId;
  this.currentCommandId = body.commandId;
  
  try {
    // NEW: Complete workflow
    const result = await this.executeCompleteWorkflow(body);
    
    await this.sendResponse({
      sessionId: body.sessionId,
      commandId: body.commandId,
      timestamp: Date.now(),
      success: true,
      summary: result.summary,
      filesChanged: result.filesChanged,
      siteUrl: result.siteUrl,  // NEW: Include deployed URL
    });
  } catch (error: any) {
    // Error handling (existing)
  }
}

private async executeCompleteWorkflow(message: any): Promise<any> {
  const result: any = {
    filesChanged: [],
    summary: '',
    siteUrl: `http://edit.${message.clientId}.webordinary.com`
  };
  
  try {
    // Step 1: Execute Claude Code
    this.logger.log('Executing Claude command...');
    const claudeResult = await this.executeClaudeCode(message);
    result.filesChanged = claudeResult.filesChanged || [];
    result.summary = claudeResult.output || '';
    
    // Step 2: Commit changes
    if (result.filesChanged.length > 0) {
      this.logger.log('Committing changes...');
      const commitMsg = this.extractCommitMessage(message);
      await this.gitService.commit(commitMsg);
    }
    
    // Step 3: Build Astro
    this.logger.log('Building Astro site...');
    const buildSuccess = await this.buildAstro();
    
    if (buildSuccess) {
      // Step 4: Sync to S3
      this.logger.log('Syncing to S3...');
      await this.syncToS3(message.clientId);
      
      // Step 5: Push commits
      this.logger.log('Pushing to GitHub...');
      await this.gitService.pushWithRetry();
    }
    
    return result;
  } catch (error) {
    this.logger.error('Workflow failed:', error);
    // Try to push what we have
    await this.gitService.pushWithRetry();
    throw error;
  }
}
```

### 2. Implement Build with Interrupt Support
```typescript
// Add to message-processor.service.ts

private async buildAstro(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const buildProcess = spawn('npm', ['run', 'build'], {
      cwd: process.env.WORKSPACE_PATH || '/workspace',
      env: { ...process.env, NODE_ENV: 'production' }
    });
    
    // Track for interruption
    this.currentProcess = buildProcess;
    
    let buildOutput = '';
    let errorOutput = '';
    
    buildProcess.stdout?.on('data', (data) => {
      buildOutput += data.toString();
      this.logger.debug(`Build: ${data.toString().trim()}`);
    });
    
    buildProcess.stderr?.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    buildProcess.on('exit', (code) => {
      this.currentProcess = null;
      
      if (code === 0) {
        this.logger.log('Astro build successful');
        resolve(true);
      } else if (code === 130) { // SIGINT
        reject(new Error('Build interrupted'));
      } else {
        this.logger.error(`Build failed: ${errorOutput}`);
        resolve(false); // Don't fail workflow on build error
      }
    });
    
    buildProcess.on('error', (error) => {
      this.currentProcess = null;
      this.logger.error('Build process error:', error);
      resolve(false);
    });
  });
}
```

### 3. Implement S3 Sync
```typescript
// Add to message-processor.service.ts

private async syncToS3(clientId: string): Promise<void> {
  const bucket = `edit.${clientId}.webordinary.com`;
  const distPath = `${process.env.WORKSPACE_PATH}/dist`;
  
  try {
    // Check dist folder exists
    const { stdout: distCheck } = await execAsync(`ls -la ${distPath}`);
    this.logger.debug(`Dist folder contents: ${distCheck}`);
    
    // Sync to S3
    const syncCommand = `aws s3 sync ${distPath} s3://${bucket} --delete --region us-west-2`;
    this.logger.log(`Syncing to S3: ${syncCommand}`);
    
    const { stdout, stderr } = await execAsync(syncCommand, {
      env: { ...process.env },
      timeout: 60000 // 1 minute timeout
    });
    
    if (stdout) {
      this.logger.log(`S3 sync output: ${stdout}`);
    }
    if (stderr) {
      this.logger.warn(`S3 sync warnings: ${stderr}`);
    }
    
    this.logger.log(`Site updated at http://edit.${clientId}.webordinary.com`);
  } catch (error: any) {
    this.logger.error(`S3 sync failed: ${error.message}`);
    // Don't throw - deployment failure shouldn't break workflow
  }
}
```

### 4. Update Interrupt Handler
```typescript
// Update existing interruptCurrentProcess method

private async interruptCurrentProcess(): Promise<void> {
  if (this.currentProcess) {
    const processName = this.currentProcess.spawnfile;
    this.logger.log(`Interrupting ${processName} process...`);
    
    // Send SIGINT for graceful shutdown
    this.currentProcess.kill('SIGINT');
    
    // Wait for process to exit
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 5000);
      this.currentProcess?.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    
    // Auto-commit any changes
    await this.gitService.autoCommitChanges('Interrupted by new message');
    
    // If we interrupted a build, try to sync whatever was built
    if (processName === 'npm') {
      this.logger.log('Build was interrupted, attempting S3 sync anyway...');
      const clientId = this.extractClientId(this.currentSessionId);
      await this.syncToS3(clientId);
    }
    
    this.currentProcess = null;
  }
}
```

### 5. Add Helper Methods
```typescript
private extractCommitMessage(message: any): string {
  const instruction = message.instruction || message.command || 'Update';
  const sessionId = message.sessionId?.substring(0, 8) || '';
  const timestamp = new Date().toISOString().split('T')[0];
  return `[${timestamp}] ${instruction.substring(0, 72)}`;
}

private extractClientId(sessionId: string | null): string {
  // Extract from environment or session data
  return process.env.CLIENT_ID || 'amelia';
}
```

## Testing

### Test Workflow
```bash
# Send message that triggers full workflow
{
  "sessionId": "test-123",
  "commandId": "cmd-456",
  "clientId": "amelia",
  "instruction": "Add a new heading to the homepage",
  "chatThreadId": "thread-789"
}

# Verify:
# 1. Claude makes changes
# 2. Changes committed
# 3. Astro builds
# 4. S3 sync happens
# 5. Site updates at edit.amelia.webordinary.com
# 6. Commits pushed to GitHub
```

### Interrupt Testing
1. Start long build
2. Send new message
3. Verify build interrupted gracefully
4. Verify partial results synced if possible

## Acceptance Criteria
- [ ] Complete workflow executes in sequence
- [ ] Each step logs progress
- [ ] Failures in build/sync don't break workflow
- [ ] Interrupts handled at any stage
- [ ] Site updates visible after workflow
- [ ] Commits pushed to GitHub

## Time Estimate
2-3 hours

## Notes
- Build and sync can be long operations
- Must maintain interrupt capability
- S3 sync should be resilient to partial builds
- Consider adding progress notifications