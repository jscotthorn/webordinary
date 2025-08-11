# Task 02: Test Email to S3 Workflow

## Objective
Create comprehensive end-to-end tests for the complete workflow: Email → Hermes → Container → Claude → Build → S3.

## Context
This is the critical path for the system. We need to verify every step works and measure performance.

## Test Implementation

### 1. Create Email to S3 Test Suite
```typescript
// scenarios/06-email-to-s3-workflow.test.ts

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

describe('Email to S3 Complete Workflow', () => {
  let testHarness: IntegrationTestHarness;
  const testMetrics = {
    emailToContainer: 0,
    containerToS3: 0,
    totalWorkflow: 0,
  };
  
  beforeAll(() => {
    testHarness = new IntegrationTestHarness();
  });
  
  describe('Complete Email Processing', () => {
    it('should process email and deploy to S3', async () => {
      const workflowStart = Date.now();
      
      // Step 1: Send test email
      const ses = new SESClient({ region: 'us-west-2' });
      const emailId = `test-${Date.now()}@webordinary.com`;
      
      await ses.send(new SendEmailCommand({
        Source: 'test@example.com',
        Destination: { ToAddresses: [emailId] },
        Message: {
          Subject: { Data: 'Test Deployment' },
          Body: { 
            Text: { 
              Data: 'Add a test banner to the homepage with text "Integration Test Success"' 
            }
          }
        }
      }));
      
      console.log(`📧 Email sent: ${emailId}`);
      
      // Step 2: Wait for Hermes to process
      await testHarness.waitForCondition(async () => {
        // Check SQS queue for message processing
        const sqs = new SQSClient({ region: 'us-west-2' });
        const queueUrl = `https://sqs.us-west-2.amazonaws.com/${TEST_CONFIG.AWS_ACCOUNT_ID}/webordinary-email-queue`;
        
        const attrs = await sqs.send(new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages']
        }));
        
        // Queue should be empty after processing
        return attrs.Attributes?.ApproximateNumberOfMessages === '0';
      }, 30000);
      
      testMetrics.emailToContainer = Date.now() - workflowStart;
      console.log(`⚡ Email processed in ${testMetrics.emailToContainer}ms`);
      
      // Step 3: Wait for container processing
      const containerStart = Date.now();
      
      // Monitor CloudWatch for processing logs
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'S3 sync complete',
        60000
      );
      
      testMetrics.containerToS3 = Date.now() - containerStart;
      console.log(`🔨 Container processed in ${testMetrics.containerToS3}ms`);
      
      // Step 4: Verify S3 deployment
      const s3 = new S3Client({ region: 'us-west-2' });
      const bucket = 'edit.amelia.webordinary.com';
      
      const s3Object = await s3.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: 'index.html'
      }));
      
      expect(s3Object.LastModified).toBeDefined();
      
      // Step 5: Verify content
      const siteUrl = `http://${bucket}`;
      const response = await fetch(siteUrl);
      const html = await response.text();
      
      expect(html).toContain('Integration Test Success');
      
      testMetrics.totalWorkflow = Date.now() - workflowStart;
      console.log(`✅ Total workflow: ${testMetrics.totalWorkflow}ms`);
      
      // Performance assertion
      expect(testMetrics.totalWorkflow).toBeLessThan(120000); // 2 minutes max
    });
  });
  
  describe('Workflow Error Handling', () => {
    it('should handle build failures gracefully', async () => {
      // Send email with instruction that breaks build
      const emailId = `break-${Date.now()}@webordinary.com`;
      
      await ses.send(new SendEmailCommand({
        Source: 'test@example.com',
        Destination: { ToAddresses: [emailId] },
        Message: {
          Subject: { Data: 'Break Build Test' },
          Body: { 
            Text: { 
              Data: 'Delete the package.json file' 
            }
          }
        }
      }));
      
      // Wait for processing
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Build failed',
        60000
      );
      
      // Verify error was handled
      // - Check DLQ for error message
      // - Verify container didn't crash
      // - Check git still has commits
      
      const dlq = new SQSClient({ region: 'us-west-2' });
      const dlqUrl = `https://sqs.us-west-2.amazonaws.com/${TEST_CONFIG.AWS_ACCOUNT_ID}/webordinary-email-dlq`;
      
      const dlqAttrs = await dlq.send(new GetQueueAttributesCommand({
        QueueUrl: dlqUrl,
        AttributeNames: ['ApproximateNumberOfMessages']
      }));
      
      // Should have error in DLQ
      expect(Number(dlqAttrs.Attributes?.ApproximateNumberOfMessages || 0)).toBeGreaterThan(0);
    });
    
    it('should handle S3 sync failures', async () => {
      // Temporarily remove S3 permissions (would need IAM manipulation)
      // Or use wrong bucket name in test
      
      const session = await testHarness.createTestSession({
        clientId: 'nonexistent', // Bucket doesn't exist
        instruction: 'Test S3 failure'
      });
      
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'S3 sync failed',
        30000
      );
      
      // Verify graceful failure
      // - Container still running
      // - Error logged
      // - Git commits still made
    });
  });
  
  describe('Performance Benchmarks', () => {
    it('should complete simple changes quickly', async () => {
      const times: number[] = [];
      
      // Run 5 times for average
      for (let i = 0; i < 5; i++) {
        const start = Date.now();
        
        await testHarness.sendEmailAndWaitForS3({
          instruction: `Update timestamp to ${Date.now()}`,
          clientId: 'test'
        });
        
        times.push(Date.now() - start);
      }
      
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`Average workflow time: ${avgTime}ms`);
      
      expect(avgTime).toBeLessThan(90000); // 90 seconds average
    });
    
    it('should handle complex builds', async () => {
      const start = Date.now();
      
      await testHarness.sendEmailAndWaitForS3({
        instruction: 'Add 10 new pages with components',
        clientId: 'test'
      });
      
      const duration = Date.now() - start;
      console.log(`Complex build time: ${duration}ms`);
      
      expect(duration).toBeLessThan(180000); // 3 minutes for complex
    });
  });
});
```

### 2. Add Helper Methods to Test Harness
```typescript
// src/integration-test-harness.ts

export class IntegrationTestHarness {
  
  async sendEmailAndWaitForS3(options: {
    instruction: string;
    clientId: string;
    from?: string;
    to?: string;
  }): Promise<void> {
    const ses = new SESClient({ region: 'us-west-2' });
    const emailId = options.to || `test-${Date.now()}@webordinary.com`;
    
    // Send email
    await ses.send(new SendEmailCommand({
      Source: options.from || 'test@example.com',
      Destination: { ToAddresses: [emailId] },
      Message: {
        Subject: { Data: 'Test' },
        Body: { Text: { Data: options.instruction } }
      }
    }));
    
    // Wait for S3 deployment
    await this.waitForS3Deployment(options.clientId, 120000);
  }
  
  async waitForCloudWatchLog(
    logGroup: string,
    searchText: string,
    timeout: number
  ): Promise<void> {
    const logs = new CloudWatchLogsClient({ region: 'us-west-2' });
    const startTime = Date.now();
    
    await this.waitForCondition(async () => {
      const response = await logs.send(new FilterLogEventsCommand({
        logGroupName: logGroup,
        filterPattern: `"${searchText}"`,
        startTime: startTime - 60000, // Look back 1 minute
      }));
      
      return (response.events?.length || 0) > 0;
    }, timeout);
  }
  
  async getWorkflowMetrics(sessionId: string): Promise<{
    emailReceived: number;
    containerStarted: number;
    claudeCompleted: number;
    buildCompleted: number;
    s3Synced: number;
    gitPushed: number;
  }> {
    // Parse CloudWatch logs to extract timing metrics
    const logs = new CloudWatchLogsClient({ region: 'us-west-2' });
    const metrics: any = {};
    
    const response = await logs.send(new FilterLogEventsCommand({
      logGroupName: '/ecs/webordinary/edit',
      filterPattern: `"${sessionId}"`,
      startTime: Date.now() - 300000, // Last 5 minutes
    }));
    
    response.events?.forEach(event => {
      const message = event.message || '';
      if (message.includes('Email received')) {
        metrics.emailReceived = event.timestamp;
      }
      // ... parse other events
    });
    
    return metrics;
  }
}
```

### 3. Create Performance Dashboard
```typescript
// test-utils/performance-reporter.ts

export class PerformanceReporter {
  private metrics: Map<string, number[]> = new Map();
  
  record(metric: string, value: number): void {
    if (!this.metrics.has(metric)) {
      this.metrics.set(metric, []);
    }
    this.metrics.get(metric)!.push(value);
  }
  
  getReport(): string {
    let report = '\n📊 Performance Report\n';
    report += '═'.repeat(50) + '\n';
    
    this.metrics.forEach((values, metric) => {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      
      report += `\n${metric}:\n`;
      report += `  Average: ${Math.round(avg)}ms\n`;
      report += `  Min: ${min}ms\n`;
      report += `  Max: ${max}ms\n`;
    });
    
    return report;
  }
  
  async publishToCloudWatch(): Promise<void> {
    const cloudwatch = new CloudWatchClient({ region: 'us-west-2' });
    const metrics: any[] = [];
    
    this.metrics.forEach((values, metric) => {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      
      metrics.push({
        MetricName: metric,
        Value: avg,
        Unit: 'Milliseconds',
        Timestamp: new Date(),
      });
    });
    
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: 'WebOrdinary/IntegrationTests',
      MetricData: metrics,
    }));
  }
}
```

## Testing

### Run Tests
```bash
# Full workflow test
npm test -- --testNamePattern="Email to S3"

# Performance only
npm test -- --testNamePattern="Performance Benchmarks"

# Error handling
npm test -- --testNamePattern="Workflow Error"
```

### Monitor During Tests
```bash
# Watch CloudWatch logs
aws logs tail /ecs/webordinary/edit --follow

# Check S3 updates
watch -n 5 'aws s3 ls s3://edit.amelia.webordinary.com/ --recursive | tail -10'

# Monitor SQS queues
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-west-2.amazonaws.com/.../webordinary-email-queue \
  --attribute-names All
```

## Acceptance Criteria
- [ ] End-to-end test from email to S3
- [ ] Performance benchmarks captured
- [ ] Error scenarios tested
- [ ] Metrics published to CloudWatch
- [ ] All tests passing consistently
- [ ] Documentation of typical timings

## Time Estimate
3-4 hours

## Notes
- Use test email addresses to avoid spam
- Clean up S3 test data after runs
- Consider email sending limits
- May need to mock some parts for reliability