# Task 06: Error Recovery Testing

## Objective
Test error handling and recovery mechanisms throughout the system, ensuring graceful degradation and automatic recovery where possible.

## Context
The system must handle various failure scenarios:
- S3 sync failures (permissions, network)
- Git push failures (conflicts, auth)
- Build failures (syntax errors, missing deps)
- Container crashes
- Claude API failures
- Network timeouts

## Test Implementation

### 1. Error Recovery Test Suite
```typescript
// scenarios/10-error-recovery.test.ts

import { IntegrationTestHarness } from '../src/integration-test-harness.js';
import { S3Client, PutBucketPolicyCommand } from '@aws-sdk/client-s3';
import { mockServer } from '../utils/mock-server.js';

describe('Error Recovery Testing', () => {
  let testHarness: IntegrationTestHarness;
  
  beforeAll(() => {
    testHarness = new IntegrationTestHarness();
  });
  
  describe('S3 Sync Failures', () => {
    it('should handle S3 permission errors', async () => {
      // Temporarily restrict S3 permissions
      const s3 = new S3Client({ region: 'us-west-2' });
      const restrictedBucket = 'edit.restricted-test.webordinary.com';
      
      // Apply restrictive policy
      await s3.send(new PutBucketPolicyCommand({
        Bucket: restrictedBucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [{
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:PutObject',
            Resource: `arn:aws:s3:::${restrictedBucket}/*`
          }]
        })
      }));
      
      // Attempt deployment
      const session = await testHarness.createTestSession({
        clientId: 'restricted-test',
        instruction: 'Test S3 permission failure'
      });
      
      // Wait for S3 sync attempt
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'S3 sync failed.*Access Denied',
        60000
      );
      
      // Verify error was logged
      const errorLog = await testHarness.getCloudWatchLogs(
        '/ecs/webordinary/edit',
        'ERROR',
        10
      );
      
      expect(errorLog.length).toBeGreaterThan(0);
      expect(errorLog[0]).toContain('Access Denied');
      
      // Verify container didn't crash
      const containerStatus = await testHarness.getContainerStatus(
        session.containerId!
      );
      
      expect(['running', 'starting']).toContain(containerStatus);
      
      // Verify git commit was still made
      const commits = await testHarness.getGitCommits(
        `thread-${session.chatThreadId}`
      );
      
      expect(commits.length).toBeGreaterThan(0);
      
      // Clean up - restore permissions
      await s3.send(new PutBucketPolicyCommand({
        Bucket: restrictedBucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [{
            Effect: 'Allow',
            Principal: { Service: 'ecs-tasks.amazonaws.com' },
            Action: 's3:*',
            Resource: [`arn:aws:s3:::${restrictedBucket}/*`]
          }]
        })
      }));
      
      console.log('✅ S3 permission error handled gracefully');
    });
    
    it('should retry S3 sync on network failures', async () => {
      // Simulate network issues
      const session = await testHarness.createTestSession({
        clientId: 'network-test',
        instruction: 'Test network retry'
      });
      
      // Monitor for retry attempts
      const retryLogs = await testHarness.waitForMultipleCloudWatchLogs(
        '/ecs/webordinary/edit',
        'S3 sync attempt',
        3, // Expect 3 attempts
        90000
      );
      
      expect(retryLogs.length).toBeGreaterThanOrEqual(2);
      
      // Eventually should succeed or give up gracefully
      const finalLog = await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'S3 sync (complete|failed after retries)',
        30000
      );
      
      expect(finalLog).toBeDefined();
      console.log('✅ S3 sync retry mechanism working');
    });
  });
  
  describe('Git Operation Failures', () => {
    it('should handle git push conflicts', async () => {
      const threadId = `conflict-test-${Date.now()}`;
      
      // Create initial session
      const session1 = await testHarness.createTestSession({
        chatThreadId: threadId,
        instruction: 'Create initial content'
      });
      
      await testHarness.waitForGitPush(`thread-${threadId}`);
      
      // Simulate conflict by pushing directly to branch
      await testHarness.pushDirectToGit(
        `thread-${threadId}`,
        'Conflicting change from external source'
      );
      
      // Create another session with same thread
      const session2 = await testHarness.createTestSession({
        chatThreadId: threadId,
        instruction: 'Make different changes'
      });
      
      // Monitor for conflict handling
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'git push.*rejected',
        60000
      );
      
      // Should attempt to resolve
      const resolutionLog = await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        '(Pulling changes|Rebasing|Merge conflict)',
        30000
      );
      
      expect(resolutionLog).toBeDefined();
      
      // Verify final state
      const finalCommits = await testHarness.getGitCommits(
        `thread-${threadId}`
      );
      
      // Should have both changes in history
      expect(finalCommits.length).toBeGreaterThanOrEqual(2);
      
      console.log('✅ Git conflict handled');
    });
    
    it('should handle git authentication failures', async () => {
      // Temporarily use invalid credentials
      process.env.GITHUB_TOKEN = 'invalid-token';
      
      const session = await testHarness.createTestSession({
        chatThreadId: `auth-fail-${Date.now()}`,
        instruction: 'Test auth failure'
      });
      
      // Should log auth error
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Authentication failed',
        30000
      );
      
      // Should save work locally
      const localCommitLog = await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Saved work locally',
        10000
      );
      
      expect(localCommitLog).toBeDefined();
      
      // Restore valid token
      process.env.GITHUB_TOKEN = process.env.VALID_GITHUB_TOKEN;
      
      // Retry should succeed
      await testHarness.retryGitPush(session.sessionId);
      
      const successLog = await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Git push complete',
        30000
      );
      
      expect(successLog).toBeDefined();
      
      console.log('✅ Git auth failure recovered');
    });
  });
  
  describe('Build Failures', () => {
    it('should handle Astro build errors', async () => {
      const session = await testHarness.createTestSession({
        instruction: 'Delete package.json file'  // Will break build
      });
      
      // Wait for build failure
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Build failed',
        60000
      );
      
      // Should not deploy broken build to S3
      const s3DeployLog = await testHarness.checkCloudWatchLog(
        '/ecs/webordinary/edit',
        'S3 sync complete',
        5000
      );
      
      expect(s3DeployLog).toBe(false);
      
      // Should save error state
      const errorState = await testHarness.getSessionState(session.sessionId);
      expect(errorState.lastError).toContain('build');
      
      // Send fix command
      await testHarness.sendMessage({
        sessionId: session.sessionId,
        instruction: 'Restore package.json file'
      });
      
      // Should recover and build successfully
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Build complete',
        60000
      );
      
      await testHarness.waitForS3Deployment(session.clientId);
      
      console.log('✅ Build failure recovered');
    });
    
    it('should handle partial build outputs', async () => {
      const session = await testHarness.createTestSession({
        instruction: 'Create syntax error in component'
      });
      
      // Build will partially succeed
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Build completed with warnings',
        60000
      );
      
      // Should deploy what was built
      const s3Objects = await testHarness.listS3Objects(
        `edit.${session.clientId}.webordinary.com`
      );
      
      expect(s3Objects.length).toBeGreaterThan(0);
      
      // Should mark session with warning
      const sessionState = await testHarness.getSessionState(session.sessionId);
      expect(sessionState.warnings).toBeDefined();
      expect(sessionState.warnings.length).toBeGreaterThan(0);
      
      console.log('✅ Partial build handled');
    });
  });
  
  describe('Container Crashes', () => {
    it('should recover from container OOM', async () => {
      const session = await testHarness.createTestSession({
        instruction: 'Create 1000 large files' // Memory intensive
      });
      
      // Monitor for OOM
      const oomLog = await testHarness.checkCloudWatchLog(
        '/ecs/webordinary/edit',
        'OutOfMemoryError|container killed',
        120000
      );
      
      if (oomLog) {
        // Container should be restarted by ECS
        await testHarness.waitForContainerRestart(session.containerId!);
        
        // Session should be recoverable
        const recoveredSession = await testHarness.resumeSession(
          session.sessionId
        );
        
        expect(recoveredSession.status).toBe('running');
        
        // Work should be preserved in git
        const commits = await testHarness.getGitCommits(
          `thread-${session.chatThreadId}`
        );
        
        expect(commits.length).toBeGreaterThan(0);
        
        console.log('✅ Container OOM recovery successful');
      } else {
        console.log('⚠️ OOM not triggered (container handled load)');
      }
    });
    
    it('should handle container network disconnection', async () => {
      const session = await testHarness.createTestSession({
        clientId: 'network-fail',
        instruction: 'Test network failure'
      });
      
      // Simulate network partition
      await testHarness.simulateNetworkPartition(
        session.containerId!,
        10000 // 10 seconds
      );
      
      // Container should handle disconnection
      const errorLog = await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Network error|Connection lost',
        15000
      );
      
      expect(errorLog).toBeDefined();
      
      // Should recover after network restored
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Connection restored|Reconnected',
        30000
      );
      
      // Should complete pending operations
      await testHarness.waitForS3Deployment('network-fail');
      
      console.log('✅ Network disconnection handled');
    });
  });
  
  describe('Claude API Failures', () => {
    it('should handle Claude API timeouts', async () => {
      // Mock slow Claude response
      await mockServer.mockClaudeDelay(30000); // 30 second delay
      
      const session = await testHarness.createTestSession({
        instruction: 'Complex task requiring Claude'
      });
      
      // Should timeout and retry
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Claude request timeout',
        35000
      );
      
      // Should retry with backoff
      const retryLog = await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Retrying Claude request',
        10000
      );
      
      expect(retryLog).toBeDefined();
      
      // Clear mock delay
      await mockServer.clearMocks();
      
      // Should eventually succeed
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Claude command completed',
        60000
      );
      
      console.log('✅ Claude timeout handled');
    });
    
    it('should handle Claude API errors', async () => {
      // Mock Claude error response
      await mockServer.mockClaudeError(429, 'Rate limit exceeded');
      
      const session = await testHarness.createTestSession({
        instruction: 'Test Claude error'
      });
      
      // Should log error
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Claude API error.*429',
        30000
      );
      
      // Should implement exponential backoff
      const backoffLogs = await testHarness.getCloudWatchLogs(
        '/ecs/webordinary/edit',
        'Backing off.*seconds',
        5
      );
      
      expect(backoffLogs.length).toBeGreaterThan(0);
      
      // Clear mock
      await mockServer.clearMocks();
      
      // Should recover
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Claude command completed',
        120000
      );
      
      console.log('✅ Claude API error handled');
    });
  });
  
  describe('Cascade Failure Prevention', () => {
    it('should prevent cascade failures', async () => {
      const sessions = [];
      
      // Create multiple sessions
      for (let i = 0; i < 5; i++) {
        sessions.push(await testHarness.createTestSession({
          clientId: `cascade-${i}`,
          instruction: 'Normal task'
        }));
      }
      
      // Cause failure in one session
      await testHarness.injectFailure(sessions[2].sessionId, 'BUILD_ERROR');
      
      // Other sessions should continue
      const healthySessions = sessions.filter((_, i) => i !== 2);
      
      for (const session of healthySessions) {
        await testHarness.waitForS3Deployment(session.clientId, 120000);
        
        const status = await testHarness.getSessionState(session.sessionId);
        expect(status.lastError).toBeUndefined();
      }
      
      console.log('✅ Cascade failure prevented');
    });
    
    it('should implement circuit breaker for S3', async () => {
      // Cause multiple S3 failures
      for (let i = 0; i < 5; i++) {
        await testHarness.createTestSession({
          clientId: 'nonexistent-bucket',
          instruction: `Fail test ${i}`
        });
        
        await testHarness.waitForCloudWatchLog(
          '/ecs/webordinary/edit',
          'S3 sync failed',
          30000
        );
      }
      
      // Circuit breaker should open
      const circuitLog = await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Circuit breaker open.*S3',
        10000
      );
      
      expect(circuitLog).toBeDefined();
      
      // New requests should fail fast
      const fastFailSession = await testHarness.createTestSession({
        clientId: 'circuit-test',
        instruction: 'Should fail fast'
      });
      
      const failFastLog = await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Circuit breaker prevented S3 sync',
        5000
      );
      
      expect(failFastLog).toBeDefined();
      
      console.log('✅ Circuit breaker working');
    });
  });
});
```

### 2. Mock Server Utility
```typescript
// utils/mock-server.ts

import express from 'express';
import { Server } from 'http';

class MockServer {
  private app: express.Application;
  private server: Server | null = null;
  private mocks: Map<string, any> = new Map();
  
  constructor() {
    this.app = express();
    this.setupRoutes();
  }
  
  private setupRoutes(): void {
    // Mock Claude API
    this.app.post('/claude/api/*', async (req, res) => {
      const mock = this.mocks.get('claude');
      
      if (mock?.delay) {
        await new Promise(resolve => setTimeout(resolve, mock.delay));
      }
      
      if (mock?.error) {
        res.status(mock.error.status).json({
          error: mock.error.message
        });
      } else {
        res.json({
          result: 'Mock Claude response'
        });
      }
    });
  }
  
  async start(port = 3001): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        console.log(`Mock server running on port ${port}`);
        resolve();
      });
    });
  }
  
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          resolve();
        });
      });
    }
  }
  
  async mockClaudeDelay(ms: number): Promise<void> {
    this.mocks.set('claude', { delay: ms });
  }
  
  async mockClaudeError(status: number, message: string): Promise<void> {
    this.mocks.set('claude', { 
      error: { status, message }
    });
  }
  
  async clearMocks(): Promise<void> {
    this.mocks.clear();
  }
}

export const mockServer = new MockServer();
```

### 3. Test Harness Error Injection
```typescript
// src/integration-test-harness.ts additions

export class IntegrationTestHarness {
  
  async injectFailure(sessionId: string, type: string): Promise<void> {
    // Update session state to trigger failure
    const dynamodb = new DynamoDBClient({ region: 'us-west-2' });
    
    await dynamodb.send(new UpdateItemCommand({
      TableName: 'webordinary-edit-sessions',
      Key: { sessionId: { S: sessionId } },
      UpdateExpression: 'SET failureInjection = :type',
      ExpressionAttributeValues: {
        ':type': { S: type }
      }
    }));
  }
  
  async simulateNetworkPartition(
    containerId: string,
    durationMs: number
  ): Promise<void> {
    // Would require network policy changes
    // For testing, we can update container metadata
    console.log(`Simulating network partition for ${durationMs}ms`);
    
    // Mark container as disconnected
    await this.updateContainerMetadata(containerId, {
      networkStatus: 'disconnected'
    });
    
    setTimeout(async () => {
      await this.updateContainerMetadata(containerId, {
        networkStatus: 'connected'
      });
    }, durationMs);
  }
  
  async waitForContainerRestart(containerId: string): Promise<void> {
    // Monitor for new task with same container ID
    await this.waitForCondition(async () => {
      const tasks = await this.getContainerTasks(containerId);
      // Check if new task started
      return tasks.some(task => 
        task.createdAt > Date.now() - 60000
      );
    }, 120000);
  }
  
  async retryGitPush(sessionId: string): Promise<void> {
    // Trigger manual retry
    const sqs = new SQSClient({ region: 'us-west-2' });
    
    await sqs.send(new SendMessageCommand({
      QueueUrl: 'https://sqs.us-west-2.amazonaws.com/.../retry-queue',
      MessageBody: JSON.stringify({
        action: 'RETRY_GIT_PUSH',
        sessionId
      })
    }));
  }
}
```

## Testing

### Run Error Recovery Tests
```bash
# All error recovery tests
npm test -- --testNamePattern="Error Recovery"

# Specific failure types
npm test -- --testNamePattern="S3 Sync Failures"
npm test -- --testNamePattern="Git Operation Failures"
npm test -- --testNamePattern="Container Crashes"

# With verbose logging
npm test -- --testNamePattern="Error Recovery" --verbose
```

### Monitor During Tests
```bash
# Watch error logs
aws logs tail /ecs/webordinary/edit --follow --filter-pattern ERROR

# Check DLQ
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-west-2.amazonaws.com/.../webordinary-dlq \
  --attribute-names ApproximateNumberOfMessages

# Monitor container restarts
watch -n 5 'aws ecs list-tasks --cluster webordinary-edit-cluster --desired-status STOPPED | jq .taskArns | wc -l'
```

## Acceptance Criteria
- [ ] S3 failures handled gracefully
- [ ] Git conflicts resolved
- [ ] Build failures don't crash system
- [ ] Container crashes recover
- [ ] Claude API failures retry
- [ ] Circuit breakers working
- [ ] No cascade failures
- [ ] All error paths tested

## Time Estimate
2-3 hours

## Notes
- Some failures hard to simulate perfectly
- May need mock services for reliability
- Clean up test artifacts
- Document any flaky tests
- Consider chaos engineering tools for production