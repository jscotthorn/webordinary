# Task 06: Integration Testing System

## Overview
Implement comprehensive integration testing to verify the complete email-to-preview workflow, session management, container orchestration, and infrastructure reliability. This ensures the system works end-to-end before inviting external testers.

## Testing Scope & Architecture

### 1. **End-to-End Workflow Testing**
Test the complete user journey from email to live preview:
```
Email → SES → SQS → Hermes → DynamoDB → ECS Scaling → Container → Preview URL → Auto-Shutdown
```

### 2. **Component Integration Testing**
Verify all AWS services work together correctly:
- **ALB Routing**: Path-based routing to correct services
- **Session Management**: DynamoDB with CloudWatch metrics
- **Container Orchestration**: ECS with EFS persistence
- **Auto-Scaling**: CloudWatch-triggered scaling events
- **Security**: VPC security groups and IAM permissions

### 3. **Infrastructure Resilience Testing**
Ensure system handles failures gracefully:
- Container crashes and restarts
- Network partitions and timeouts
- Resource exhaustion scenarios
- Cost control and auto-shutdown

## Test Environment Strategy

### Integration Test Stack
Deploy a separate `IntegrationTestStack` that mirrors production but with:
- Smaller container sizes (0.25 vCPU, 0.5GB RAM)
- Shorter timeouts (1-minute idle vs 5-minute)
- Test-specific ALB rules and domains
- Isolated DynamoDB table and CloudWatch metrics

### Test Data Management
- **Git Repository**: `webordinary-integration-tests` with sample Astro site
- **Test Sessions**: Isolated DynamoDB partition with `TEST_` prefix
- **EFS Workspace**: Separate access point for test workspaces
- **Container Images**: Use `:test` tags for integration test images

## Core Integration Test Scenarios

### Scenario 1: Cold Start Session Flow
**Objective**: Verify complete cold start from 0 containers
```typescript
describe('Cold Start Session Flow', () => {
  test('should create session and scale containers from zero', async () => {
    // 1. Verify services start at 0 tasks
    await verifyServiceTaskCount('hermes', 0);
    await verifyServiceTaskCount('edit', 0);
    
    // 2. Trigger session creation via API
    const session = await createTestSession({
      clientId: 'test-client',
      userId: 'test@example.com',
      instruction: 'Add a new page called "Test Page"'
    });
    
    // 3. Verify session in DynamoDB
    await verifySessionExists(session.sessionId);
    
    // 4. Wait for container scaling (max 60s)
    await waitForContainerReady(session.sessionId, 60000);
    
    // 5. Verify preview URL accessible
    const response = await fetch(session.previewUrl);
    expect(response.status).toBe(200);
    
    // 6. Verify file changes persisted to EFS
    await verifyFileExists(`/workspace/test-client/test/project/src/pages/test-page.astro`);
    
    // 7. Verify auto-shutdown after idle timeout
    await waitForIdle(70000); // 1min + buffer
    await verifyServiceTaskCount('edit', 0);
    await verifySessionStatus(session.sessionId, 'expired');
  });
});
```

### Scenario 2: Session Persistence & Resume
**Objective**: Verify EFS persistence across container restarts
```typescript
describe('Session Persistence', () => {
  test('should maintain workspace state across container restarts', async () => {
    // 1. Create session and make changes
    const session1 = await createTestSession({
      instruction: 'Create a components/Header.astro file'
    });
    
    await waitForContainerReady(session1.sessionId);
    await verifyFileExists(`/workspace/test-client/test/project/src/components/Header.astro`);
    
    // 2. Force container shutdown
    await forceScaleDown('edit', 0);
    await waitForServiceStable('edit');
    
    // 3. Create new session (should resume from existing workspace)
    const session2 = await createTestSession({
      clientId: 'test-client',
      userId: 'test@example.com',
      instruction: 'Update Header.astro with new content'
    });
    
    // 4. Verify previous files still exist
    await waitForContainerReady(session2.sessionId);
    await verifyFileExists(`/workspace/test-client/test/project/src/components/Header.astro`);
    
    // 5. Verify git history preserved
    const gitLog = await execInContainer(session2.sessionId, 'git log --oneline');
    expect(gitLog).toContain('Create Header component');
  });
});
```

### Scenario 3: Concurrent Session Handling
**Objective**: Verify multiple sessions work independently
```typescript
describe('Concurrent Sessions', () => {
  test('should handle multiple concurrent sessions', async () => {
    // 1. Create multiple sessions simultaneously
    const sessions = await Promise.all([
      createTestSession({ userId: 'user1@test.com', instruction: 'Create page A' }),
      createTestSession({ userId: 'user2@test.com', instruction: 'Create page B' }),
      createTestSession({ userId: 'user3@test.com', instruction: 'Create page C' })
    ]);
    
    // 2. Verify all sessions created in DynamoDB
    for (const session of sessions) {
      await verifySessionExists(session.sessionId);
    }
    
    // 3. Verify containers scaled appropriately (should be 3 or limited by max)
    const taskCount = await getServiceTaskCount('edit');
    expect(taskCount).toBeGreaterThan(0);
    expect(taskCount).toBeLessThanOrEqual(3); // Max capacity
    
    // 4. Verify each session has isolated workspace
    for (let i = 0; i < sessions.length; i++) {
      const expectedFile = `/workspace/test-client/user${i+1}/project/src/pages/page-${String.fromCharCode(65+i).toLowerCase()}.astro`;
      await verifyFileExists(expectedFile);
    }
    
    // 5. Verify sessions auto-shutdown independently
    await waitForAllSessionsExpired(sessions);
    await verifyServiceTaskCount('edit', 0);
  });
});
```

### Scenario 4: ALB Routing Integration
**Objective**: Verify path-based routing works correctly
```typescript
describe('ALB Routing', () => {
  test('should route requests to correct services', async () => {
    const session = await createTestSession();
    await waitForContainerReady(session.sessionId);
    
    // Test API routing
    const apiResponse = await fetch(`${ALB_ENDPOINT}/api/health`);
    expect(apiResponse.status).toBe(200);
    
    // Test Hermes routing  
    const hermesResponse = await fetch(`${ALB_ENDPOINT}/hermes/health`);
    expect(hermesResponse.status).toBe(200);
    
    // Test session routing
    const sessionResponse = await fetch(`${ALB_ENDPOINT}/session/${session.sessionId}`);
    expect(sessionResponse.status).toBe(200);
    
    // Test WebSocket upgrade
    const ws = new WebSocket(`wss://${ALB_DOMAIN}/ws/hmr`);
    await waitForWebSocketOpen(ws);
    ws.close();
  });
});
```

### Scenario 5: Failure Recovery Testing
**Objective**: Verify system handles failures gracefully
```typescript
describe('Failure Recovery', () => {
  test('should recover from container failures', async () => {
    const session = await createTestSession();
    await waitForContainerReady(session.sessionId);
    
    // Force container failure
    await killContainerProcess(session.sessionId);
    
    // Verify ECS restarts container
    await waitForContainerReady(session.sessionId, 120000);
    
    // Verify session data preserved
    await verifySessionExists(session.sessionId);
    await verifyFileExists(`/workspace/test-client/test/project/package.json`);
  });
  
  test('should handle DynamoDB throttling', async () => {
    // Create many sessions rapidly to trigger throttling
    const promises = Array(20).fill(null).map((_, i) => 
      createTestSession({ userId: `stress${i}@test.com` })
    );
    
    const results = await Promise.allSettled(promises);
    
    // Some should succeed, failures should be handled gracefully
    const successes = results.filter(r => r.status === 'fulfilled');
    expect(successes.length).toBeGreaterThan(0);
    
    // Failed attempts should not leave orphaned resources
    await verifyNoOrphanedContainers();
  });
});
```

## Test Infrastructure Implementation

### 1. **Test Harness Setup**
```typescript
// tests/integration/setup.ts
export class IntegrationTestHarness {
  constructor(
    private readonly ecsClient: ECSClient,
    private readonly dynamoClient: DynamoDBClient,
    private readonly albEndpoint: string
  ) {}
  
  async createTestSession(params: CreateSessionParams): Promise<TestSession> {
    const response = await fetch(`${this.albEndpoint}/hermes/api/sessions/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: params.clientId || 'test-client',
        userId: params.userId,
        instruction: params.instruction
      })
    });
    
    return await response.json();
  }
  
  async waitForContainerReady(sessionId: string, timeoutMs = 60000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(`${this.albEndpoint}/session/${sessionId}/health`);
        if (response.ok) return;
      } catch (error) {
        // Container not ready yet
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    throw new Error(`Container not ready after ${timeoutMs}ms`);
  }
  
  async verifyFileExists(filePath: string): Promise<void> {
    // Use ECS Exec to check file existence in container
    const command = `test -f "${filePath}" && echo "EXISTS" || echo "MISSING"`;
    const result = await this.execInContainer(command);
    expect(result.trim()).toBe('EXISTS');
  }
  
  async cleanup(): Promise<void> {
    // Clean up test sessions and resources
    await this.deleteTestSessions();
    await this.scaleServicesToZero();
    await this.cleanupTestWorkspaces();
  }
}
```

### 2. **Test Configuration**
```typescript
// tests/integration/config.ts
export const TEST_CONFIG = {
  AWS: {
    region: 'us-west-2',
    account: '942734823970',
    profile: 'personal'
  },
  SERVICES: {
    clusterName: 'webordinary-edit-cluster',
    hermesService: 'webordinary-hermes-service',
    editService: 'webordinary-edit-service'
  },
  ENDPOINTS: {
    alb: 'https://webordinary-edit-alb-916355172.us-west-2.elb.amazonaws.com',
    hermes: 'https://webordinary-edit-alb-916355172.us-west-2.elb.amazonaws.com/hermes',
    api: 'https://webordinary-edit-alb-916355172.us-west-2.elb.amazonaws.com/api'
  },
  TIMEOUTS: {
    containerReady: 60000,
    sessionExpiry: 70000,
    scaleDown: 30000
  },
  TEST_DATA: {
    clientId: 'integration-test-client',
    repository: 'webordinary-integration-tests',
    workspace: '/workspace/integration-test-client'
  }
};
```

### 3. **CI/CD Integration**
```yaml
# .github/workflows/integration-tests.yml
name: Integration Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  integration:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Configure AWS credentials
      uses: aws-actions/configure-aws-credentials@v1
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: us-west-2
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '20'
        
    - name: Install dependencies
      run: |
        cd tests/integration
        npm ci
        
    - name: Run integration tests
      run: |
        cd tests/integration
        npm run test:integration
        
    - name: Upload test results
      uses: actions/upload-artifact@v3
      if: always()
      with:
        name: integration-test-results
        path: tests/integration/results/
```

## Monitoring & Observability

### 1. **Test Metrics Dashboard**
Create CloudWatch dashboard showing:
- Test execution success rate
- Average session startup time
- Resource utilization during tests
- Error rates by test scenario
- Cost per test run

### 2. **Test Result Reporting**
```typescript
// tests/integration/reporting.ts
export class TestReporter {
  async generateReport(results: TestResults[]): Promise<TestReport> {
    return {
      summary: {
        total: results.length,
        passed: results.filter(r => r.status === 'passed').length,
        failed: results.filter(r => r.status === 'failed').length,
        duration: results.reduce((acc, r) => acc + r.duration, 0)
      },
      performance: {
        avgContainerStartupTime: this.calculateAverage(results, 'containerStartupTime'),
        avgSessionCreationTime: this.calculateAverage(results, 'sessionCreationTime'),
        avgAutoShutdownTime: this.calculateAverage(results, 'autoShutdownTime')
      },
      costs: {
        fargateHours: this.calculateFargateUsage(results),
        dynamodbOperations: this.calculateDynamoUsage(results),
        estimatedCost: this.calculateTestCosts(results)
      }
    };
  }
}
```

## Implementation Plan

### Phase 1: Test Infrastructure (Days 1-2)
- [ ] Create integration test harness and utilities
- [ ] Set up test configuration and environment
- [ ] Implement basic AWS service clients and helpers
- [ ] Create test data management system

### Phase 2: Core Integration Tests (Days 3-5)
- [ ] Implement Scenario 1: Cold start session flow
- [ ] Implement Scenario 2: Session persistence testing
- [ ] Implement Scenario 3: Concurrent session handling
- [ ] Implement Scenario 4: ALB routing verification

### Phase 3: Resilience Testing (Days 6-7)
- [ ] Implement Scenario 5: Failure recovery testing
- [ ] Add stress testing and load scenarios
- [ ] Implement chaos engineering tests
- [ ] Create performance benchmarking

### Phase 4: CI/CD Integration (Day 8)
- [ ] Set up GitHub Actions workflow
- [ ] Configure AWS credentials and permissions
- [ ] Implement test result reporting
- [ ] Create CloudWatch monitoring dashboard

### Phase 5: Documentation & Optimization (Day 9)
- [ ] Document test scenarios and expected results
- [ ] Optimize test execution time and resource usage
- [ ] Create troubleshooting guide for test failures
- [ ] Set up alerts for test regression

## Success Criteria

### 1. **Functional Coverage**
- ✅ End-to-end workflow: Email → Preview URL (< 60s)
- ✅ Session persistence across container restarts
- ✅ Concurrent session isolation and resource sharing
- ✅ ALB routing to all service endpoints
- ✅ Auto-scaling triggers and shutdown behavior

### 2. **Performance Targets**
- ✅ Cold start session creation: < 60 seconds
- ✅ Warm session creation: < 5 seconds  
- ✅ Auto-shutdown trigger: < 5 minutes idle
- ✅ Container health check: < 30 seconds
- ✅ File persistence verification: < 2 seconds

### 3. **Reliability Metrics**
- ✅ Test success rate: > 95%
- ✅ Container restart recovery: < 2 minutes
- ✅ Session data consistency: 100%
- ✅ Resource cleanup: 100% (no orphans)
- ✅ Cost predictability: ± 10% of estimates

### 4. **Operational Readiness**
- ✅ Automated test execution in CI/CD
- ✅ Test result reporting and alerting
- ✅ Performance regression detection
- ✅ Failure root cause identification
- ✅ Cost tracking and optimization

## Risk Mitigation

| Risk | Mitigation Strategy |
|------|-------------------|
| **AWS rate limiting** | Implement exponential backoff and retry logic |
| **Container startup failures** | Add health check retries and fallback containers |
| **Test flakiness** | Use deterministic timing and proper async handling |
| **Cost overrun** | Set billing alerts and automatic resource cleanup |
| **Test data isolation** | Use separate workspaces and cleanup procedures |

## Cost Analysis

### Test Infrastructure Costs
- **Development**: ~$15-25/month for test executions
- **CI/CD**: ~$5-10/month for automated test runs
- **Monitoring**: ~$2-5/month for CloudWatch metrics
- **Storage**: ~$1-2/month for test data and logs

### Cost per Test Run
- **Single test**: ~$0.10-0.25 (5-15 minutes of container time)
- **Full suite**: ~$1-3 (30-90 minutes total execution)
- **Daily CI/CD**: ~$30-90/month if run on every commit

---

**Task 06 Objective**: Establish comprehensive integration testing that validates the complete system works reliably before external user testing, with automated CI/CD integration and detailed performance/cost monitoring.

**Timeline**: 9 days
**Prerequisites**: Tasks 00-05 completed and deployed
**Success Metric**: 95%+ test success rate with < 60s cold start performance