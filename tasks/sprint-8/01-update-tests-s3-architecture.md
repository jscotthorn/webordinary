# Task 01: Update Tests for S3 Architecture

## Objective
Update existing integration tests to work with the new S3 static hosting architecture, removing container web serving assumptions.

## Context
Tests currently assume:
- ALB routing to containers on port 8080
- Container health checks via HTTP
- Preview URLs served by containers

New reality:
- S3 serves static sites directly
- No ALB routing to containers for web
- Containers only process messages and deploy to S3

## Changes Required

### 1. Update Test Configuration
```typescript
// config/test-config.ts

export const TEST_CONFIG = {
  // ... existing config
  
  // OLD - Remove or deprecate
  // ALB_ENDPOINT: process.env.ALB_ENDPOINT || 'https://webordinary-edit-alb-xxx.elb.amazonaws.com',
  
  // NEW - Add S3 endpoints
  S3_BUCKETS: {
    test: 'edit.test.webordinary.com',
    amelia: 'edit.amelia.webordinary.com',
  },
  
  S3_ENDPOINTS: {
    test: 'http://edit.test.webordinary.com.s3-website-us-west-2.amazonaws.com',
    amelia: 'http://edit.amelia.webordinary.com',
  },
  
  // Container checks now via CloudWatch logs, not HTTP
  CONTAINER_HEALTH_CHECK: 'cloudwatch-logs',
  
  // Build/deploy timeouts
  BUILD_TIMEOUT: 60000,  // 1 minute for Astro build
  S3_SYNC_TIMEOUT: 30000, // 30 seconds for S3 sync
};
```

### 2. Update ALB Routing Test
```typescript
// scenarios/04-alb-routing.test.ts
// RENAME to: 04-s3-deployment.test.ts

describe('S3 Deployment Verification', () => {
  
  describe('Static Site Deployment', () => {
    it('should deploy to S3 after container processing', async () => {
      // Create session and send message
      const session = await testHarness.createTestSession({
        clientId: 'test',
        instruction: 'Add test content to homepage'
      });
      
      // Wait for processing (no container health check needed)
      await testHarness.waitForProcessing(session.sessionId);
      
      // Verify S3 deployment
      const s3Client = new S3Client({ region: 'us-west-2' });
      const bucket = TEST_CONFIG.S3_BUCKETS.test;
      
      // Check index.html exists
      const response = await s3Client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: 'index.html'
      }));
      
      expect(response.ContentLength).toBeGreaterThan(0);
      expect(response.LastModified).toBeDefined();
      
      // Verify site is accessible
      const siteUrl = TEST_CONFIG.S3_ENDPOINTS.test;
      const siteResponse = await fetch(siteUrl);
      expect(siteResponse.status).toBe(200);
      
      const html = await siteResponse.text();
      expect(html).toContain('<!DOCTYPE html>');
    });
  });
  
  describe('S3 Sync Verification', () => {
    it('should update S3 on subsequent changes', async () => {
      const session = await testHarness.createTestSession({
        clientId: 'test',
        instruction: 'Initial content'
      });
      
      await testHarness.waitForProcessing(session.sessionId);
      
      // Get initial last modified time
      const s3Client = new S3Client({ region: 'us-west-2' });
      const initial = await s3Client.send(new HeadObjectCommand({
        Bucket: TEST_CONFIG.S3_BUCKETS.test,
        Key: 'index.html'
      }));
      
      // Send update
      await testHarness.sendMessage({
        sessionId: session.sessionId,
        instruction: 'Update content'
      });
      
      await testHarness.waitForProcessing(session.sessionId);
      
      // Verify S3 was updated
      const updated = await s3Client.send(new HeadObjectCommand({
        Bucket: TEST_CONFIG.S3_BUCKETS.test,
        Key: 'index.html'
      }));
      
      expect(updated.LastModified?.getTime()).toBeGreaterThan(
        initial.LastModified?.getTime() || 0
      );
    });
  });
});
```

### 3. Update Test Harness
```typescript
// src/integration-test-harness.ts

export class IntegrationTestHarness {
  
  // Remove or update container health checks
  async waitForContainerReady(sessionId: string): Promise<void> {
    // OLD: Check ALB health endpoint
    // NEW: Check CloudWatch logs for container startup
    
    const logs = new CloudWatchLogsClient({ region: 'us-west-2' });
    const logGroup = '/ecs/webordinary/edit';
    
    await this.waitForCondition(async () => {
      const response = await logs.send(new FilterLogEventsCommand({
        logGroupName: logGroup,
        filterPattern: `"Session ${sessionId} started"`,
        startTime: Date.now() - 300000, // Last 5 minutes
      }));
      
      return response.events && response.events.length > 0;
    }, 60000);
  }
  
  // NEW: Wait for S3 deployment
  async waitForS3Deployment(clientId: string, timeout = 60000): Promise<void> {
    const bucket = `edit.${clientId}.webordinary.com`;
    const s3Client = new S3Client({ region: 'us-west-2' });
    
    await this.waitForCondition(async () => {
      try {
        const response = await s3Client.send(new HeadObjectCommand({
          Bucket: bucket,
          Key: 'index.html'
        }));
        
        // Check if recently modified (within last 2 minutes)
        const lastModified = response.LastModified?.getTime() || 0;
        const twoMinutesAgo = Date.now() - 120000;
        
        return lastModified > twoMinutesAgo;
      } catch (error) {
        return false;
      }
    }, timeout);
  }
  
  // NEW: Verify S3 content
  async verifyS3Content(clientId: string, searchText: string): Promise<boolean> {
    const url = `http://edit.${clientId}.webordinary.com`;
    
    try {
      const response = await fetch(url);
      const html = await response.text();
      return html.includes(searchText);
    } catch (error) {
      console.error('Failed to fetch S3 site:', error);
      return false;
    }
  }
}
```

### 4. Update Cold Start Test
```typescript
// scenarios/01-cold-start-session-flow.test.ts

describe('Cold Start Session Flow', () => {
  
  describe('Complete Cold Start Flow', () => {
    it('should process from email to S3 deployment', async () => {
      const startTime = Date.now();
      
      // Scale down to ensure cold start
      await testHarness.scaleService('webordinary-edit-service', 0);
      await testHarness.waitForScale(0);
      
      // Send email (or simulate)
      const session = await testHarness.createTestSession({
        clientId: 'test',
        instruction: 'Create homepage'
      });
      
      // Wait for container to start (via CloudWatch)
      await testHarness.waitForContainerStart(session.sessionId);
      
      // Wait for S3 deployment
      await testHarness.waitForS3Deployment('test');
      
      // Verify deployment
      const deployed = await testHarness.verifyS3Content('test', 'homepage');
      expect(deployed).toBe(true);
      
      // Check timing
      const totalTime = Date.now() - startTime;
      expect(totalTime).toBeLessThan(120000); // 2 minutes max
      
      console.log(`Cold start to S3: ${totalTime}ms`);
    });
  });
});
```

### 5. Remove Obsolete Tests
```typescript
// Remove or comment out:
// - WebSocket upgrade tests (no longer applicable)
// - Container port health checks
// - ALB target group tests
// - Preview URL routing tests (now direct to S3)
```

## Testing

### Verify Changes
```bash
# Run updated tests
cd tests/integration
npm test -- --testNamePattern="S3 Deployment"

# Check S3 buckets manually
aws s3 ls s3://edit.test.webordinary.com/
aws s3 cp s3://edit.test.webordinary.com/index.html -
```

### Expected Results
- Tests should pass with new S3 checks
- No more ALB health check failures
- S3 content verification working
- CloudWatch log monitoring functional

## Acceptance Criteria
- [ ] Test config updated for S3
- [ ] ALB routing tests replaced with S3 tests
- [ ] Test harness has S3 verification methods
- [ ] Cold start test works with S3
- [ ] Obsolete tests removed or marked skip
- [ ] All updated tests passing

## Time Estimate
3-4 hours

## Notes
- Keep test structure, just update assertions
- Add retry logic for S3 eventual consistency
- Consider S3 costs in test cleanup
- Document changes for other developers