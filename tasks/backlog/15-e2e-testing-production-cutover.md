# Task 14: End-to-End Testing and Production Cutover

## Overview
Comprehensive testing of the complete WebOrdinary system followed by production deployment and DNS cutover to make ameliastamps.com live on the new platform.

## Background
- All core features implemented (Tasks 08-13)
- System components integrated but not fully tested
- Need thorough validation before production
- Zero-downtime cutover required

## Requirements

### Testing Coverage
1. **End-to-End User Flows**
   - Email instruction → Live preview
   - Approval workflow → Production deploy
   - Branch management → PR creation
   - Content editing → Auto-commit

2. **System Integration**
   - Hermes → Claude Code communication
   - Fargate scaling (0 → N → 0)
   - Lambda builds → S3 deployment
   - CloudFront invalidation

3. **Performance Validation**
   - Load testing for concurrent sessions
   - Response time benchmarks
   - Resource usage monitoring
   - Cost projections

4. **Production Readiness**
   - Security audit
   - Backup and recovery
   - Monitoring and alerting
   - Documentation complete

## Testing Implementation

### 1. E2E Test Suite
```typescript
// Comprehensive end-to-end tests
describe('WebOrdinary E2E Tests', () => {
  describe('Email to Preview Flow', () => {
    it('should create preview from email instruction', async () => {
      // Send test email
      const emailId = await sendTestEmail({
        to: 'test@ameliastamps.com',
        subject: 'Update homepage',
        body: 'Please change the homepage title to "Welcome to Amelia Stamps"',
      });
      
      // Wait for processing
      await waitForCondition(async () => {
        const session = await getSessionByEmailId(emailId);
        return session?.status === 'active';
      }, { timeout: 60000 });
      
      // Verify Fargate scaled up
      const tasks = await ecs.describeTasks({
        cluster: 'webordinary-edit-cluster',
        tasks: await ecs.listTasks({
          cluster: 'webordinary-edit-cluster',
          serviceName: 'webordinary-edit-service',
        }).promise().then(r => r.taskArns),
      }).promise();
      
      expect(tasks.tasks.length).toBeGreaterThan(0);
      
      // Check preview available
      const session = await getSessionByEmailId(emailId);
      const previewUrl = `https://edit.ameliastamps.com/session/${session.sessionId}/`;
      const response = await fetch(previewUrl);
      
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Welcome to Amelia Stamps');
      
      // Verify auto-commit
      const commits = await github.listCommits({
        owner: 'ameliastamps',
        repo: 'website',
        sha: `thread-${session.threadId}`,
      });
      
      expect(commits.data[0].commit.message).toContain('Update homepage');
    });
    
    it('should handle approval workflow', async () => {
      // Send instruction requiring approval
      const emailId = await sendTestEmail({
        to: 'test@ameliastamps.com',
        subject: 'Delete products',
        body: 'Delete all products from the catalog',
      });
      
      // Wait for approval email
      const approvalEmail = await waitForApprovalEmail(emailId);
      expect(approvalEmail).toBeDefined();
      expect(approvalEmail.body).toContain('Approval Required');
      
      // Extract and use approval token
      const token = extractApprovalToken(approvalEmail);
      const approvalResponse = await fetch(
        `https://api.ameliastamps.com/api/approve/${token}`,
      );
      
      expect(approvalResponse.status).toBe(200);
      
      // Verify changes applied
      await waitForCondition(async () => {
        const status = await getDeploymentStatus(emailId);
        return status === 'completed';
      });
    });
  });
  
  describe('Scaling and Performance', () => {
    it('should handle concurrent sessions', async () => {
      // Create multiple sessions simultaneously
      const sessions = await Promise.all(
        Array(5).fill(0).map((_, i) => 
          createSession(`test-user-${i}`, `thread-${i}`),
        ),
      );
      
      // Verify Fargate scaled appropriately
      const metrics = await cloudwatch.getMetricStatistics({
        Namespace: 'Webordinary/EditSessions',
        MetricName: 'ActiveSessionCount',
        StartTime: new Date(Date.now() - 300000),
        EndTime: new Date(),
        Period: 60,
        Statistics: ['Maximum'],
      }).promise();
      
      expect(metrics.Datapoints[0].Maximum).toBe(5);
      
      // Check all sessions accessible
      for (const session of sessions) {
        const response = await fetch(
          `https://edit.ameliastamps.com/session/${session.sessionId}/`,
        );
        expect(response.status).toBe(200);
      }
      
      // Cleanup and verify scale-down
      for (const session of sessions) {
        await deactivateSession(session.sessionId);
      }
      
      await waitForCondition(async () => {
        const tasks = await ecs.listTasks({
          cluster: 'webordinary-edit-cluster',
          serviceName: 'webordinary-edit-service',
        }).promise();
        return tasks.taskArns.length === 0;
      }, { timeout: 120000 });
    });
    
    it('should meet performance benchmarks', async () => {
      const metrics = {
        emailToPreview: [],
        buildTime: [],
        deploymentTime: [],
      };
      
      // Run performance tests
      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        
        const emailId = await sendTestEmail({
          to: 'perf-test@ameliastamps.com',
          subject: `Performance test ${i}`,
          body: 'Update homepage title',
        });
        
        await waitForPreviewReady(emailId);
        metrics.emailToPreview.push(Date.now() - start);
        
        const buildStart = Date.now();
        await triggerBuild(emailId, 'staging');
        await waitForBuildComplete(emailId);
        metrics.buildTime.push(Date.now() - buildStart);
      }
      
      // Assert performance requirements
      const avgEmailToPreview = average(metrics.emailToPreview);
      const avgBuildTime = average(metrics.buildTime);
      
      expect(avgEmailToPreview).toBeLessThan(60000); // < 1 minute
      expect(avgBuildTime).toBeLessThan(120000); // < 2 minutes
    });
  });
  
  describe('Production Deployment', () => {
    it('should deploy to production with approval', async () => {
      // Create and approve changes
      const pr = await createPullRequest('test-branch', 'Production deploy test');
      await approvePullRequest(pr.number);
      await mergePullRequest(pr.number);
      
      // Trigger production build
      const buildResult = await triggerProductionBuild('main');
      expect(buildResult.success).toBe(true);
      
      // Verify CloudFront invalidation
      const invalidations = await cloudfront.listInvalidations({
        DistributionId: PRODUCTION_DISTRIBUTION_ID,
      }).promise();
      
      expect(invalidations.InvalidationList.Items[0].Status).toBe('InProgress');
      
      // Check production site
      const response = await fetch('https://ameliastamps.com');
      expect(response.status).toBe(200);
    });
  });
});
```

### 2. Load Testing Script
```typescript
// Artillery load testing configuration
const loadTestConfig = {
  config: {
    target: 'https://api.ameliastamps.com',
    phases: [
      { duration: 60, arrivalRate: 1 }, // Warm up
      { duration: 120, arrivalRate: 5 }, // Ramp up
      { duration: 300, arrivalRate: 10 }, // Sustained load
      { duration: 60, arrivalRate: 1 }, // Cool down
    ],
    variables: {
      threadIds: Array(100).fill(0).map((_, i) => `load-test-${i}`),
    },
  },
  scenarios: [
    {
      name: 'Create Session Flow',
      flow: [
        {
          post: {
            url: '/api/sessions/activate',
            json: {
              email: 'load-test@example.com',
              threadId: '{{ threadId }}',
            },
          },
        },
        { think: 5 },
        {
          get: {
            url: '/api/sessions/{{ sessionId }}/status',
          },
        },
        { think: 10 },
        {
          post: {
            url: '/api/sessions/{{ sessionId }}/deactivate',
          },
        },
      ],
    },
  ],
};
```

### 3. Security Audit Checklist
```typescript
// Security validation tests
describe('Security Audit', () => {
  it('should enforce authentication on all endpoints', async () => {
    const protectedEndpoints = [
      '/api/sessions/activate',
      '/api/github/pr',
      '/api/build/trigger',
      '/api/approve/*',
    ];
    
    for (const endpoint of protectedEndpoints) {
      const response = await fetch(`https://api.ameliastamps.com${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      });
      
      expect([401, 403]).toContain(response.status);
    }
  });
  
  it('should sanitize user inputs', async () => {
    const xssPayloads = [
      '<script>alert("XSS")</script>',
      '"><script>alert("XSS")</script>',
      "'; DROP TABLE sessions; --",
    ];
    
    for (const payload of xssPayloads) {
      const response = await sendTestEmail({
        to: 'security-test@ameliastamps.com',
        subject: payload,
        body: payload,
      });
      
      // Verify payload is escaped in responses
      const session = await getSession(response.sessionId);
      expect(session.emailSubject).not.toContain('<script>');
      expect(session.emailSubject).toContain('&lt;script&gt;');
    }
  });
  
  it('should validate approval tokens', async () => {
    // Test invalid token
    const response = await fetch(
      'https://api.ameliastamps.com/api/approve/invalid-token',
    );
    expect(response.status).toBe(400);
    
    // Test expired token
    const expiredToken = generateExpiredToken();
    const expiredResponse = await fetch(
      `https://api.ameliastamps.com/api/approve/${expiredToken}`,
    );
    expect(expiredResponse.status).toBe(401);
    
    // Test token replay
    const validToken = await generateValidToken();
    await fetch(`https://api.ameliastamps.com/api/approve/${validToken}`);
    const replayResponse = await fetch(
      `https://api.ameliastamps.com/api/approve/${validToken}`,
    );
    expect(replayResponse.status).toBe(401);
  });
});
```

### 4. Production Cutover Script
```bash
#!/bin/bash
# Production cutover automation

set -e

echo "🚀 Starting WebOrdinary Production Cutover"

# Step 1: Pre-flight checks
echo "Step 1: Running pre-flight checks..."
npm run test:e2e
npm run test:security
npm run test:performance

# Step 2: Backup current production
echo "Step 2: Backing up current production..."
aws s3 sync s3://ameliastamps-production s3://ameliastamps-backup-$(date +%Y%m%d)

# Step 3: Deploy latest code to production
echo "Step 3: Deploying to production..."
git checkout main
git pull origin main
npm run build:production
aws s3 sync dist/ s3://ameliastamps-production --delete

# Step 4: Invalidate CloudFront
echo "Step 4: Invalidating CloudFront cache..."
aws cloudfront create-invalidation \
  --distribution-id $PRODUCTION_DISTRIBUTION_ID \
  --paths "/*"

# Step 5: Update DNS (if needed)
echo "Step 5: Updating DNS records..."
aws route53 change-resource-record-sets \
  --hosted-zone-id $HOSTED_ZONE_ID \
  --change-batch file://dns-cutover.json

# Step 6: Verify production
echo "Step 6: Verifying production site..."
curl -I https://ameliastamps.com
npm run test:production

# Step 7: Monitor for issues
echo "Step 7: Monitoring for issues (5 minutes)..."
npm run monitor:production -- --duration 300

echo "✅ Production cutover complete!"
```

### 5. Monitoring Setup
```typescript
// CloudWatch alarms configuration
const alarms = [
  {
    name: 'HighErrorRate',
    metric: 'Errors',
    threshold: 10,
    period: 300,
    evaluationPeriods: 2,
    alarmActions: [SNS_TOPIC_ARN],
  },
  {
    name: 'HighLatency',
    metric: 'Duration',
    threshold: 3000,
    period: 60,
    evaluationPeriods: 3,
    alarmActions: [SNS_TOPIC_ARN],
  },
  {
    name: 'FargateTaskFailure',
    metric: 'TaskCount',
    threshold: 0,
    period: 300,
    evaluationPeriods: 1,
    comparisonOperator: 'LessThanThreshold',
    alarmActions: [SNS_TOPIC_ARN],
  },
  {
    name: 'HighCost',
    metric: 'EstimatedCharges',
    threshold: 100,
    period: 86400,
    evaluationPeriods: 1,
    alarmActions: [SNS_TOPIC_ARN],
  },
];
```

## Testing Phases

### Phase 1: Component Testing
1. Test individual services in isolation
2. Verify API endpoints
3. Validate data flows
4. Check error handling

### Phase 2: Integration Testing
1. Test service-to-service communication
2. Verify end-to-end workflows
3. Test failure scenarios
4. Validate recovery procedures

### Phase 3: Performance Testing
1. Load test with expected traffic
2. Stress test to find limits
3. Measure response times
4. Monitor resource usage

### Phase 4: Production Validation
1. Deploy to staging environment
2. Run full test suite
3. Perform security audit
4. User acceptance testing

## Production Cutover Plan

### Pre-Cutover (T-24 hours)
- [ ] Final code review completed
- [ ] All tests passing
- [ ] Backup procedures verified
- [ ] Rollback plan documented
- [ ] Team briefed on cutover

### Cutover Window (T-0)
- [ ] Set maintenance mode on old site
- [ ] Deploy code to production
- [ ] Run smoke tests
- [ ] Update DNS records
- [ ] Monitor for issues

### Post-Cutover (T+24 hours)
- [ ] Monitor error rates
- [ ] Check performance metrics
- [ ] Gather user feedback
- [ ] Document lessons learned
- [ ] Celebrate success! 🎉

## Success Criteria

### Functional Requirements
- [ ] All E2E tests passing
- [ ] Email flow working end-to-end
- [ ] Approval workflow functional
- [ ] Auto-scaling operational
- [ ] Production deployment successful

### Performance Requirements
- [ ] Page load < 3 seconds
- [ ] API response < 500ms
- [ ] 99.9% uptime SLA
- [ ] Zero data loss
- [ ] Successful failover tested

### Security Requirements
- [ ] All endpoints authenticated
- [ ] Input validation working
- [ ] Token security verified
- [ ] SSL/TLS configured
- [ ] Security headers present

## Rollback Plan

### Immediate Rollback (< 5 minutes)
```bash
# Quick DNS revert
aws route53 change-resource-record-sets \
  --hosted-zone-id $HOSTED_ZONE_ID \
  --change-batch file://dns-rollback.json

# Restore previous S3 content
aws s3 sync s3://ameliastamps-backup-$(date +%Y%m%d) \
  s3://ameliastamps-production --delete
```

### Full Rollback (< 30 minutes)
1. Revert DNS to old infrastructure
2. Restore database from backup
3. Redeploy previous container versions
4. Clear CloudFront cache
5. Notify users of temporary issue

## Monitoring Dashboard

### Key Metrics
- Active sessions count
- API response times
- Error rates by endpoint
- Fargate task count
- CloudFront cache hit ratio
- S3 bandwidth usage
- Lambda execution duration
- DynamoDB read/write capacity

### Alert Thresholds
- Error rate > 1%
- Response time > 1 second
- Failed deployments
- Security violations
- Cost anomalies

## Documentation Checklist

### User Documentation
- [ ] Admin guide written
- [ ] API documentation complete
- [ ] Troubleshooting guide
- [ ] FAQ updated

### Technical Documentation
- [ ] Architecture diagrams
- [ ] Deployment procedures
- [ ] Monitoring runbook
- [ ] Disaster recovery plan

## Dependencies
- All previous tasks (08-13) completed
- Production AWS resources provisioned
- DNS control for ameliastamps.com
- SSL certificates configured
- Monitoring tools set up

## Estimated Timeline
- Component Testing: 4 hours
- Integration Testing: 6 hours
- Performance Testing: 4 hours
- Security Audit: 3 hours
- Production Cutover: 2 hours
- Monitoring Setup: 2 hours
- **Total: 2.5-3 days**

## Post-Launch Tasks
- Monitor system for 48 hours
- Gather performance metrics
- Collect user feedback
- Plan optimization sprint
- Document lessons learned

## Notes
- Schedule cutover during low-traffic period
- Have team on standby during cutover
- Prepare communication plan for users
- Keep old system available for 30 days
- Plan celebration for successful launch! 🚀