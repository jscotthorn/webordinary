# Task 04: Multi-Session S3 Testing

## Objective
Test rapid session switching with S3 deployments, ensuring each session maintains its own state and S3 reflects the correct content for each session.

## Context
With S3 static hosting, we need to ensure:
- Multiple sessions can deploy to different S3 buckets/paths
- Session switching doesn't contaminate deployments
- Concurrent builds work correctly
- Each client's site reflects their specific session state

## Test Implementation

### 1. Multi-Session S3 Test Suite
```typescript
// scenarios/08-multi-session-s3.test.ts

import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { IntegrationTestHarness } from '../src/integration-test-harness.js';
import crypto from 'crypto';

describe('Multi-Session S3 Deployment', () => {
  let testHarness: IntegrationTestHarness;
  const s3Client = new S3Client({ region: 'us-west-2' });
  
  beforeAll(() => {
    testHarness = new IntegrationTestHarness();
  });
  
  describe('Session Isolation', () => {
    it('should maintain separate S3 deployments per session', async () => {
      // Create two sessions for different clients
      const session1 = await testHarness.createTestSession({
        clientId: 'client-a',
        chatThreadId: `thread-a-${Date.now()}`,
        instruction: 'Add header with text "Client A Site"'
      });
      
      const session2 = await testHarness.createTestSession({
        clientId: 'client-b',
        chatThreadId: `thread-b-${Date.now()}`,
        instruction: 'Add header with text "Client B Site"'
      });
      
      // Wait for both to process
      await Promise.all([
        testHarness.waitForS3Deployment('client-a'),
        testHarness.waitForS3Deployment('client-b')
      ]);
      
      // Verify each S3 bucket has unique content
      const contentA = await s3Client.send(new GetObjectCommand({
        Bucket: 'edit.client-a.webordinary.com',
        Key: 'index.html'
      }));
      
      const contentB = await s3Client.send(new GetObjectCommand({
        Bucket: 'edit.client-b.webordinary.com',
        Key: 'index.html'
      }));
      
      const htmlA = await contentA.Body?.transformToString();
      const htmlB = await contentB.Body?.transformToString();
      
      expect(htmlA).toContain('Client A Site');
      expect(htmlA).not.toContain('Client B Site');
      
      expect(htmlB).toContain('Client B Site');
      expect(htmlB).not.toContain('Client A Site');
      
      console.log('✅ Session isolation verified');
    });
    
    it('should handle rapid session switching', async () => {
      const clientId = 'switch-test';
      const sessions = [];
      
      // Create 5 sessions in rapid succession
      for (let i = 0; i < 5; i++) {
        const session = await testHarness.createTestSession({
          clientId,
          chatThreadId: `thread-${i}-${Date.now()}`,
          instruction: `Update page title to "Version ${i + 1}"`
        });
        sessions.push(session);
        
        // Small delay between sessions
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Wait for last session to deploy
      await testHarness.waitForS3Deployment(clientId);
      
      // Verify final S3 state matches last session
      const content = await s3Client.send(new GetObjectCommand({
        Bucket: `edit.${clientId}.webordinary.com`,
        Key: 'index.html'
      }));
      
      const html = await content.Body?.transformToString();
      expect(html).toContain('Version 5');
      
      // Verify git branches exist for all sessions
      for (const session of sessions) {
        const branchExists = await testHarness.verifyGitBranch(
          `thread-${session.chatThreadId}`
        );
        expect(branchExists).toBe(true);
      }
      
      console.log('✅ Rapid session switching handled');
    });
  });
  
  describe('Concurrent Deployments', () => {
    it('should handle concurrent builds and S3 syncs', async () => {
      const startTime = Date.now();
      const concurrentSessions = 3;
      
      // Create concurrent sessions for different clients
      const sessionPromises = [];
      for (let i = 0; i < concurrentSessions; i++) {
        sessionPromises.push(
          testHarness.createTestSession({
            clientId: `concurrent-${i}`,
            chatThreadId: `concurrent-thread-${i}`,
            instruction: `Create site for client ${i}`
          })
        );
      }
      
      const sessions = await Promise.all(sessionPromises);
      
      // Wait for all deployments
      const deploymentPromises = sessions.map((_, i) => 
        testHarness.waitForS3Deployment(`concurrent-${i}`)
      );
      
      await Promise.all(deploymentPromises);
      
      // Verify all deployments completed
      for (let i = 0; i < concurrentSessions; i++) {
        const objects = await s3Client.send(new ListObjectsV2Command({
          Bucket: `edit.concurrent-${i}.webordinary.com`,
          MaxKeys: 10
        }));
        
        expect(objects.Contents?.length).toBeGreaterThan(0);
        console.log(`✅ Concurrent deployment ${i + 1} verified`);
      }
      
      const totalTime = Date.now() - startTime;
      console.log(`⏱️ ${concurrentSessions} concurrent deployments: ${totalTime}ms`);
      
      // Should complete reasonably quickly
      expect(totalTime).toBeLessThan(180000); // 3 minutes for 3 concurrent
    });
    
    it('should prevent cross-session contamination', async () => {
      // Create session with unique content
      const session1 = await testHarness.createTestSession({
        clientId: 'contamination-test',
        chatThreadId: 'unique-content-1',
        instruction: 'Add secret key ABC123 to config'
      });
      
      await testHarness.waitForS3Deployment('contamination-test');
      
      // Create different session for same client
      const session2 = await testHarness.createTestSession({
        clientId: 'contamination-test',
        chatThreadId: 'unique-content-2',
        instruction: 'Add different key XYZ789 to config'
      });
      
      await testHarness.waitForS3Deployment('contamination-test');
      
      // Verify S3 only has content from latest session
      const content = await s3Client.send(new GetObjectCommand({
        Bucket: 'edit.contamination-test.webordinary.com',
        Key: 'index.html'
      }));
      
      const html = await content.Body?.transformToString();
      
      // Should have new content, not old
      expect(html).toContain('XYZ789');
      expect(html).not.toContain('ABC123');
      
      // But git should preserve both in separate branches
      const branch1Commit = await testHarness.getLatestCommit('thread-unique-content-1');
      const branch2Commit = await testHarness.getLatestCommit('thread-unique-content-2');
      
      expect(branch1Commit).toBeDefined();
      expect(branch2Commit).toBeDefined();
      expect(branch1Commit.sha).not.toBe(branch2Commit.sha);
      
      console.log('✅ No cross-session contamination');
    });
  });
  
  describe('S3 State Management', () => {
    it('should handle S3 sync failures gracefully', async () => {
      // Create session with invalid S3 bucket
      const session = await testHarness.createTestSession({
        clientId: 'invalid-bucket-test',
        instruction: 'Test S3 failure handling'
      });
      
      // Should fail but not crash
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'S3 sync failed',
        30000
      );
      
      // Container should still be running
      const containerStatus = await testHarness.getContainerStatus(
        session.containerId!
      );
      
      expect(['running', 'starting']).toContain(containerStatus);
      
      // Git commits should still exist
      const commits = await testHarness.getGitCommits(
        `thread-${session.chatThreadId}`
      );
      
      expect(commits.length).toBeGreaterThan(0);
      console.log('✅ S3 failure handled gracefully');
    });
    
    it('should track S3 deployment metrics', async () => {
      const metrics = {
        buildTimes: [] as number[],
        syncTimes: [] as number[],
        totalTimes: [] as number[]
      };
      
      // Run 3 deployments and measure
      for (let i = 0; i < 3; i++) {
        const startTime = Date.now();
        
        const session = await testHarness.createTestSession({
          clientId: 'metrics-test',
          chatThreadId: `metrics-${i}`,
          instruction: `Update timestamp to ${Date.now()}`
        });
        
        // Monitor CloudWatch for timing events
        const buildStart = Date.now();
        await testHarness.waitForCloudWatchLog(
          '/ecs/webordinary/edit',
          'Starting Astro build',
          30000
        );
        
        await testHarness.waitForCloudWatchLog(
          '/ecs/webordinary/edit',
          'Build complete',
          60000
        );
        const buildTime = Date.now() - buildStart;
        metrics.buildTimes.push(buildTime);
        
        const syncStart = Date.now();
        await testHarness.waitForCloudWatchLog(
          '/ecs/webordinary/edit',
          'S3 sync complete',
          30000
        );
        const syncTime = Date.now() - syncStart;
        metrics.syncTimes.push(syncTime);
        
        const totalTime = Date.now() - startTime;
        metrics.totalTimes.push(totalTime);
      }
      
      // Calculate averages
      const avgBuild = metrics.buildTimes.reduce((a, b) => a + b, 0) / 3;
      const avgSync = metrics.syncTimes.reduce((a, b) => a + b, 0) / 3;
      const avgTotal = metrics.totalTimes.reduce((a, b) => a + b, 0) / 3;
      
      console.log('📊 S3 Deployment Metrics:');
      console.log(`   Avg Build Time: ${Math.round(avgBuild)}ms`);
      console.log(`   Avg Sync Time: ${Math.round(avgSync)}ms`);
      console.log(`   Avg Total Time: ${Math.round(avgTotal)}ms`);
      
      // Performance assertions
      expect(avgBuild).toBeLessThan(45000); // 45s avg build
      expect(avgSync).toBeLessThan(15000); // 15s avg sync
      expect(avgTotal).toBeLessThan(90000); // 90s avg total
    });
  });
});
```

### 2. Add Helper Methods
```typescript
// src/integration-test-harness.ts additions

export class IntegrationTestHarness {
  
  async getGitCommits(branchName: string, limit = 10): Promise<any[]> {
    const github = new Octokit({
      auth: process.env.GITHUB_TOKEN
    });
    
    const { data: commits } = await github.repos.listCommits({
      owner: 'webordinary',
      repo: 'test-repo',
      sha: branchName,
      per_page: limit
    });
    
    return commits;
  }
  
  async getContainerStatus(containerId: string): Promise<string> {
    const dynamodb = new DynamoDBClient({ region: 'us-west-2' });
    
    const response = await dynamodb.send(new GetItemCommand({
      TableName: 'webordinary-containers',
      Key: {
        containerId: { S: containerId }
      }
    }));
    
    return response.Item?.status?.S || 'unknown';
  }
  
  async compareS3Objects(bucket1: string, bucket2: string): Promise<{
    unique1: string[];
    unique2: string[];
    common: string[];
  }> {
    const s3 = new S3Client({ region: 'us-west-2' });
    
    const list1 = await s3.send(new ListObjectsV2Command({
      Bucket: bucket1
    }));
    
    const list2 = await s3.send(new ListObjectsV2Command({
      Bucket: bucket2
    }));
    
    const keys1 = new Set(list1.Contents?.map(obj => obj.Key) || []);
    const keys2 = new Set(list2.Contents?.map(obj => obj.Key) || []);
    
    const common = [...keys1].filter(key => keys2.has(key));
    const unique1 = [...keys1].filter(key => !keys2.has(key));
    const unique2 = [...keys2].filter(key => !keys1.has(key));
    
    return { unique1, unique2, common };
  }
}
```

## Testing

### Run Tests
```bash
# All multi-session tests
npm test -- --testNamePattern="Multi-Session S3"

# Specific scenarios
npm test -- --testNamePattern="Session Isolation"
npm test -- --testNamePattern="Concurrent Deployments"
```

### Manual Verification
```bash
# Check S3 buckets for different clients
aws s3 ls s3://edit.client-a.webordinary.com/
aws s3 ls s3://edit.client-b.webordinary.com/

# Compare bucket contents
aws s3 sync s3://edit.client-a.webordinary.com ./client-a --dryrun
aws s3 sync s3://edit.client-b.webordinary.com ./client-b --dryrun

# Monitor during tests
watch -n 2 'aws s3 ls s3://edit.*.webordinary.com/ 2>/dev/null | head -20'
```

## Acceptance Criteria
- [ ] Session isolation verified
- [ ] Rapid switching works
- [ ] Concurrent deployments successful
- [ ] No cross-contamination
- [ ] S3 failures handled
- [ ] Performance metrics captured
- [ ] All tests passing

## Time Estimate
2-3 hours

## Notes
- Create test S3 buckets before running
- Clean up S3 objects after tests
- Consider S3 rate limits
- May need unique bucket names for parallel test runs