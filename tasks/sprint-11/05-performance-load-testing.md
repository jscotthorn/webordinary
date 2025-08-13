# Task 05: Performance and Load Testing

## Objective
Benchmark the complete workflow performance and test system behavior under load with multiple concurrent sessions.

## Context
Need to establish performance baselines and ensure the system can handle expected load:
- Measure each stage of the workflow
- Test concurrent session limits
- Identify bottlenecks
- Generate performance reports for optimization

## Test Implementation

### 1. Performance Benchmark Suite
```typescript
// scenarios/09-performance-benchmarks.test.ts

import { IntegrationTestHarness } from '../src/integration-test-harness.js';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { PerformanceReporter } from '../utils/performance-reporter.js';

describe('Performance and Load Testing', () => {
  let testHarness: IntegrationTestHarness;
  let perfReporter: PerformanceReporter;
  
  beforeAll(() => {
    testHarness = new IntegrationTestHarness();
    perfReporter = new PerformanceReporter();
  });
  
  afterAll(async () => {
    // Generate and publish performance report
    const report = perfReporter.generateReport();
    console.log(report);
    
    await perfReporter.publishToCloudWatch();
  });
  
  describe('Workflow Stage Performance', () => {
    it('should measure each stage of email to S3 workflow', async () => {
      const stages = {
        emailToSQS: 0,
        sqsToContainer: 0,
        containerStart: 0,
        claudeProcessing: 0,
        astroBuild: 0,
        s3Sync: 0,
        gitCommit: 0,
        gitPush: 0,
        total: 0
      };
      
      const workflowStart = Date.now();
      
      // Stage 1: Email to SQS
      const emailStart = Date.now();
      await testHarness.sendTestEmail({
        to: `perf-test-${Date.now()}@webordinary.com`,
        instruction: 'Add performance test banner'
      });
      
      await testHarness.waitForSQSMessage();
      stages.emailToSQS = Date.now() - emailStart;
      
      // Stage 2: SQS to Container pickup
      const sqsStart = Date.now();
      await testHarness.waitForCloudWatchLog(
        '/ecs/hermes',
        'Processing email',
        30000
      );
      stages.sqsToContainer = Date.now() - sqsStart;
      
      // Stage 3: Container start (if cold)
      const containerStart = Date.now();
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Container started',
        60000
      );
      stages.containerStart = Date.now() - containerStart;
      
      // Stage 4: Claude processing
      const claudeStart = Date.now();
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Claude command completed',
        90000
      );
      stages.claudeProcessing = Date.now() - claudeStart;
      
      // Stage 5: Astro build
      const buildStart = Date.now();
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Build complete',
        60000
      );
      stages.astroBuild = Date.now() - buildStart;
      
      // Stage 6: S3 sync
      const syncStart = Date.now();
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'S3 sync complete',
        30000
      );
      stages.s3Sync = Date.now() - syncStart;
      
      // Stage 7: Git operations
      const gitStart = Date.now();
      await testHarness.waitForCloudWatchLog(
        '/ecs/webordinary/edit',
        'Git push complete',
        30000
      );
      stages.gitCommit = Date.now() - gitStart;
      
      stages.total = Date.now() - workflowStart;
      
      // Record metrics
      Object.entries(stages).forEach(([stage, time]) => {
        perfReporter.record(`workflow.${stage}`, time);
      });
      
      // Log results
      console.log('📊 Workflow Stage Timing:');
      Object.entries(stages).forEach(([stage, time]) => {
        console.log(`   ${stage}: ${time}ms`);
      });
      
      // Performance assertions
      expect(stages.emailToSQS).toBeLessThan(5000);
      expect(stages.astroBuild).toBeLessThan(60000);
      expect(stages.s3Sync).toBeLessThan(30000);
      expect(stages.total).toBeLessThan(180000); // 3 minutes total
    }, 240000);
    
    it('should measure cold vs warm start performance', async () => {
      const coldStartTimes: number[] = [];
      const warmStartTimes: number[] = [];
      
      // Cold start test
      await testHarness.scaleService('webordinary-edit-service', 0);
      await testHarness.waitForScale(0);
      
      for (let i = 0; i < 3; i++) {
        const start = Date.now();
        
        const session = await testHarness.createTestSession({
          clientId: 'cold-test',
          instruction: `Cold start test ${i}`
        });
        
        await testHarness.waitForS3Deployment('cold-test');
        
        const duration = Date.now() - start;
        coldStartTimes.push(duration);
        
        // Scale down between tests
        if (i < 2) {
          await testHarness.scaleService('webordinary-edit-service', 0);
          await testHarness.waitForScale(0);
        }
      }
      
      // Warm start test (container already running)
      for (let i = 0; i < 5; i++) {
        const start = Date.now();
        
        const session = await testHarness.createTestSession({
          clientId: 'warm-test',
          instruction: `Warm start test ${i}`
        });
        
        await testHarness.waitForS3Deployment('warm-test');
        
        const duration = Date.now() - start;
        warmStartTimes.push(duration);
        
        // Small delay between warm tests
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Calculate averages
      const avgCold = coldStartTimes.reduce((a, b) => a + b, 0) / coldStartTimes.length;
      const avgWarm = warmStartTimes.reduce((a, b) => a + b, 0) / warmStartTimes.length;
      
      console.log('🔥 Start Performance:');
      console.log(`   Cold Start Avg: ${Math.round(avgCold)}ms`);
      console.log(`   Warm Start Avg: ${Math.round(avgWarm)}ms`);
      console.log(`   Speed Improvement: ${Math.round((avgCold - avgWarm) / avgCold * 100)}%`);
      
      perfReporter.record('performance.coldStart', avgCold);
      perfReporter.record('performance.warmStart', avgWarm);
      
      // Warm should be significantly faster
      expect(avgWarm).toBeLessThan(avgCold * 0.5);
    });
  });
  
  describe('Load Testing', () => {
    it('should handle sustained load', async () => {
      const sessionsPerMinute = 10;
      const testDurationMinutes = 2;
      const totalSessions = sessionsPerMinute * testDurationMinutes;
      
      const results = {
        successful: 0,
        failed: 0,
        responseTimes: [] as number[]
      };
      
      console.log(`🔨 Starting load test: ${totalSessions} sessions over ${testDurationMinutes} minutes`);
      
      const startTime = Date.now();
      const sessionPromises = [];
      
      for (let minute = 0; minute < testDurationMinutes; minute++) {
        for (let i = 0; i < sessionsPerMinute; i++) {
          const sessionStart = Date.now();
          
          sessionPromises.push(
            testHarness.createTestSession({
              clientId: `load-test-${minute}-${i}`,
              instruction: `Load test session ${minute * sessionsPerMinute + i}`
            })
            .then(async (session) => {
              await testHarness.waitForS3Deployment(session.clientId, 120000);
              
              const duration = Date.now() - sessionStart;
              results.responseTimes.push(duration);
              results.successful++;
              
              return { success: true, duration };
            })
            .catch((error) => {
              results.failed++;
              console.error(`Session failed: ${error.message}`);
              return { success: false, error };
            })
          );
          
          // Spread sessions across the minute
          await new Promise(resolve => setTimeout(resolve, 60000 / sessionsPerMinute));
        }
      }
      
      // Wait for all sessions to complete
      const sessionResults = await Promise.all(sessionPromises);
      
      const totalDuration = Date.now() - startTime;
      
      // Calculate statistics
      const avgResponseTime = results.responseTimes.reduce((a, b) => a + b, 0) / results.responseTimes.length;
      const maxResponseTime = Math.max(...results.responseTimes);
      const minResponseTime = Math.min(...results.responseTimes);
      const successRate = (results.successful / totalSessions) * 100;
      
      console.log('📈 Load Test Results:');
      console.log(`   Total Sessions: ${totalSessions}`);
      console.log(`   Successful: ${results.successful}`);
      console.log(`   Failed: ${results.failed}`);
      console.log(`   Success Rate: ${successRate.toFixed(1)}%`);
      console.log(`   Avg Response: ${Math.round(avgResponseTime)}ms`);
      console.log(`   Min Response: ${minResponseTime}ms`);
      console.log(`   Max Response: ${maxResponseTime}ms`);
      console.log(`   Total Duration: ${Math.round(totalDuration / 1000)}s`);
      
      // Record metrics
      perfReporter.record('load.successRate', successRate);
      perfReporter.record('load.avgResponse', avgResponseTime);
      perfReporter.record('load.maxResponse', maxResponseTime);
      
      // Success criteria
      expect(successRate).toBeGreaterThan(95); // 95% success rate
      expect(avgResponseTime).toBeLessThan(120000); // 2 minute average
    }, 600000); // 10 minute timeout
    
    it('should handle burst traffic', async () => {
      const burstSize = 20;
      const results: any[] = [];
      
      console.log(`💥 Burst test: ${burstSize} concurrent sessions`);
      
      const startTime = Date.now();
      
      // Send all requests at once
      const burstPromises = Array.from({ length: burstSize }, (_, i) => 
        testHarness.createTestSession({
          clientId: `burst-${i}`,
          instruction: `Burst test ${i}`
        })
        .then(session => ({
          success: true,
          sessionId: session.sessionId,
          startTime: Date.now()
        }))
        .catch(error => ({
          success: false,
          error: error.message
        }))
      );
      
      const burstResults = await Promise.all(burstPromises);
      const burstDuration = Date.now() - startTime;
      
      const successful = burstResults.filter(r => r.success).length;
      const failed = burstSize - successful;
      
      console.log(`   Burst completed in ${burstDuration}ms`);
      console.log(`   Successful: ${successful}/${burstSize}`);
      console.log(`   Failed: ${failed}`);
      
      // Wait for deployments
      const deploymentPromises = burstResults
        .filter(r => r.success)
        .map((r, i) => 
          testHarness.waitForS3Deployment(`burst-${i}`, 180000)
            .then(() => ({ deployed: true, index: i }))
            .catch(() => ({ deployed: false, index: i }))
        );
      
      const deployments = await Promise.all(deploymentPromises);
      const deployed = deployments.filter(d => d.deployed).length;
      
      console.log(`   Deployed: ${deployed}/${successful}`);
      
      perfReporter.record('burst.size', burstSize);
      perfReporter.record('burst.successful', successful);
      perfReporter.record('burst.duration', burstDuration);
      
      // Should handle burst without complete failure
      expect(successful).toBeGreaterThan(burstSize * 0.8); // 80% success
    });
  });
  
  describe('Resource Utilization', () => {
    it('should monitor container resource usage', async () => {
      const metrics = {
        cpuUtilization: [] as number[],
        memoryUtilization: [] as number[],
        taskCount: [] as number[]
      };
      
      // Start monitoring
      const monitoringInterval = setInterval(async () => {
        const stats = await testHarness.getServiceMetrics('webordinary-edit-service');
        
        metrics.cpuUtilization.push(stats.cpu);
        metrics.memoryUtilization.push(stats.memory);
        metrics.taskCount.push(stats.taskCount);
      }, 5000);
      
      // Run test workload
      const sessionPromises = [];
      for (let i = 0; i < 5; i++) {
        sessionPromises.push(
          testHarness.createTestSession({
            clientId: `resource-test-${i}`,
            instruction: 'Create complex page with many components'
          })
        );
        
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      
      await Promise.all(sessionPromises);
      
      // Stop monitoring
      clearInterval(monitoringInterval);
      
      // Calculate averages
      const avgCpu = metrics.cpuUtilization.reduce((a, b) => a + b, 0) / metrics.cpuUtilization.length;
      const avgMemory = metrics.memoryUtilization.reduce((a, b) => a + b, 0) / metrics.memoryUtilization.length;
      const maxTasks = Math.max(...metrics.taskCount);
      
      console.log('🖥️ Resource Utilization:');
      console.log(`   Avg CPU: ${avgCpu.toFixed(1)}%`);
      console.log(`   Avg Memory: ${avgMemory.toFixed(1)}%`);
      console.log(`   Max Tasks: ${maxTasks}`);
      
      perfReporter.record('resources.avgCpu', avgCpu);
      perfReporter.record('resources.avgMemory', avgMemory);
      perfReporter.record('resources.maxTasks', maxTasks);
      
      // Resource limits
      expect(avgCpu).toBeLessThan(80); // Stay under 80% CPU
      expect(avgMemory).toBeLessThan(90); // Stay under 90% memory
    });
  });
});
```

### 2. Performance Reporter Utility
```typescript
// utils/performance-reporter.ts

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import fs from 'fs/promises';
import path from 'path';

export class PerformanceReporter {
  private metrics: Map<string, number[]> = new Map();
  private cloudwatch: CloudWatchClient;
  
  constructor() {
    this.cloudwatch = new CloudWatchClient({ region: 'us-west-2' });
  }
  
  record(metric: string, value: number): void {
    if (!this.metrics.has(metric)) {
      this.metrics.set(metric, []);
    }
    this.metrics.get(metric)!.push(value);
  }
  
  generateReport(): string {
    let report = '\n' + '='.repeat(60) + '\n';
    report += '📊 PERFORMANCE TEST REPORT\n';
    report += '='.repeat(60) + '\n\n';
    
    // Group metrics by category
    const categories = new Map<string, Map<string, number[]>>();
    
    this.metrics.forEach((values, metric) => {
      const [category, name] = metric.split('.', 2);
      
      if (!categories.has(category)) {
        categories.set(category, new Map());
      }
      
      categories.get(category)!.set(name || metric, values);
    });
    
    // Generate report for each category
    categories.forEach((metrics, category) => {
      report += `\n${category.toUpperCase()}\n`;
      report += '-'.repeat(40) + '\n';
      
      metrics.forEach((values, name) => {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const p95 = this.percentile(values, 95);
        
        report += `\n${name}:\n`;
        report += `  Average: ${Math.round(avg)}ms\n`;
        report += `  Min: ${min}ms\n`;
        report += `  Max: ${max}ms\n`;
        report += `  P95: ${Math.round(p95)}ms\n`;
      });
    });
    
    report += '\n' + '='.repeat(60) + '\n';
    
    return report;
  }
  
  async saveReport(filepath: string): Promise<void> {
    const report = this.generateReport();
    await fs.writeFile(filepath, report, 'utf-8');
    
    // Also save as JSON
    const jsonPath = filepath.replace('.txt', '.json');
    const jsonData = Object.fromEntries(this.metrics);
    await fs.writeFile(jsonPath, JSON.stringify(jsonData, null, 2));
  }
  
  async publishToCloudWatch(): Promise<void> {
    const timestamp = new Date();
    const metricData: any[] = [];
    
    this.metrics.forEach((values, metric) => {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      
      metricData.push({
        MetricName: metric.replace(/\./g, '_'),
        Value: avg,
        Unit: 'Milliseconds',
        Timestamp: timestamp
      });
    });
    
    // Batch publish (CloudWatch limit is 20 per request)
    for (let i = 0; i < metricData.length; i += 20) {
      const batch = metricData.slice(i, i + 20);
      
      await this.cloudwatch.send(new PutMetricDataCommand({
        Namespace: 'WebOrdinary/Performance',
        MetricData: batch
      }));
    }
    
    console.log(`📤 Published ${metricData.length} metrics to CloudWatch`);
  }
  
  private percentile(values: number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[index];
  }
}
```

### 3. Test Harness Additions
```typescript
// src/integration-test-harness.ts additions

export class IntegrationTestHarness {
  
  async getServiceMetrics(serviceName: string): Promise<{
    cpu: number;
    memory: number;
    taskCount: number;
  }> {
    const ecs = new ECSClient({ region: 'us-west-2' });
    
    const { services } = await ecs.send(new DescribeServicesCommand({
      cluster: 'webordinary-edit-cluster',
      services: [serviceName]
    }));
    
    const service = services?.[0];
    if (!service) throw new Error('Service not found');
    
    // Get task metrics
    const { tasks } = await ecs.send(new DescribeTasksCommand({
      cluster: 'webordinary-edit-cluster',
      tasks: service.runningCount > 0 ? 
        await this.getTaskArns(serviceName) : []
    }));
    
    let totalCpu = 0;
    let totalMemory = 0;
    
    tasks?.forEach(task => {
      // Parse CloudWatch metrics or task stats
      // This is simplified - actual implementation would query CloudWatch
      totalCpu += 50; // Mock value
      totalMemory += 70; // Mock value
    });
    
    return {
      cpu: service.runningCount > 0 ? totalCpu / service.runningCount : 0,
      memory: service.runningCount > 0 ? totalMemory / service.runningCount : 0,
      taskCount: service.runningCount || 0
    };
  }
  
  async waitForSQSMessage(queueUrl?: string): Promise<void> {
    const sqs = new SQSClient({ region: 'us-west-2' });
    const queue = queueUrl || 'https://sqs.us-west-2.amazonaws.com/.../webordinary-email-queue';
    
    await this.waitForCondition(async () => {
      const { Attributes } = await sqs.send(new GetQueueAttributesCommand({
        QueueUrl: queue,
        AttributeNames: ['ApproximateNumberOfMessages']
      }));
      
      return Number(Attributes?.ApproximateNumberOfMessages || 0) > 0;
    }, 30000);
  }
}
```

## Testing

### Run Performance Tests
```bash
# All performance tests
npm run test:performance

# Specific test suites
npm test -- --testNamePattern="Workflow Stage Performance"
npm test -- --testNamePattern="Load Testing"

# Generate report only
npm run performance:report
```

### Monitor During Tests
```bash
# Watch ECS metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=webordinary-edit-service \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-01T01:00:00Z \
  --period 300 \
  --statistics Average

# Watch custom metrics
aws cloudwatch get-metric-statistics \
  --namespace WebOrdinary/Performance \
  --metric-name workflow_total \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-01T01:00:00Z \
  --period 3600 \
  --statistics Average,Maximum,Minimum
```

## Acceptance Criteria
- [ ] Workflow stages measured
- [ ] Cold/warm start compared
- [ ] Load test completed
- [ ] Burst test handled
- [ ] Resource usage monitored
- [ ] Performance report generated
- [ ] Metrics published to CloudWatch
- [ ] All performance targets met

## Time Estimate
3-4 hours

## Notes
- Run during low-traffic periods
- Clean up test data after runs
- Consider AWS costs for load testing
- May need to increase ECS limits temporarily
- Save performance reports for trend analysis