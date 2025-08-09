# Task 23: Performance Testing and Optimization

## Objective
Conduct comprehensive performance testing of the multi-session SQS architecture and optimize for speed, reliability, and cost efficiency.

## Performance Targets

### Response Times
- Message processing: < 5 seconds (p50), < 15 seconds (p99)
- Container startup: < 30 seconds
- Session switch: < 2 seconds
- Preview page load: < 1 second

### Throughput
- 100 concurrent sessions across 10 containers
- 1000 messages per hour
- 10 interrupts per hour without data loss

### Resource Usage
- Container memory: < 1GB per session
- Container CPU: < 50% average utilization
- SQS queue depth: < 10 messages average

## Test Scenarios

### 1. Load Testing

```typescript
// test/performance/load-test.ts
import { performance } from 'perf_hooks';

describe('Load Testing', () => {
  const metrics: PerformanceMetrics = {
    messageTimes: [],
    containerStarts: [],
    sessionSwitches: [],
    errors: []
  };
  
  it('should handle 100 concurrent sessions', async () => {
    const sessions: TestSession[] = [];
    
    // Create 100 sessions across 10 projects
    for (let i = 0; i < 100; i++) {
      const projectId = `project-${i % 10}`;
      const userId = `user-${Math.floor(i / 10)}`;
      
      sessions.push(await createTestSession({
        clientId: 'loadtest',
        projectId,
        userId,
        chatThreadId: `thread-${i}`
      }));
    }
    
    // Send messages to all sessions concurrently
    const startTime = performance.now();
    const promises = sessions.map(async (session, index) => {
      const messageStart = performance.now();
      
      try {
        const response = await sendTestMessage(session, {
          instruction: `Create test file ${index}.txt`,
          commandId: `cmd-${index}`
        });
        
        metrics.messageTimes.push(performance.now() - messageStart);
        return response;
      } catch (error) {
        metrics.errors.push({ session: session.id, error });
        throw error;
      }
    });
    
    const results = await Promise.allSettled(promises);
    const totalTime = performance.now() - startTime;
    
    // Analyze results
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    console.log('Load Test Results:', {
      totalSessions: 100,
      successful,
      failed,
      totalTime: `${totalTime}ms`,
      avgMessageTime: `${average(metrics.messageTimes)}ms`,
      p50MessageTime: `${percentile(metrics.messageTimes, 50)}ms`,
      p99MessageTime: `${percentile(metrics.messageTimes, 99)}ms`
    });
    
    // Assertions
    expect(successful).toBeGreaterThan(95); // 95% success rate
    expect(percentile(metrics.messageTimes, 50)).toBeLessThan(5000);
    expect(percentile(metrics.messageTimes, 99)).toBeLessThan(15000);
  });
  
  it('should handle rapid session switching', async () => {
    const container = await createTestContainer({
      clientId: 'loadtest',
      projectId: 'switch-test',
      userId: 'test-user'
    });
    
    // Create multiple sessions on same container
    const sessions = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createTestSession({
          clientId: 'loadtest',
          projectId: 'switch-test',
          userId: 'test-user',
          chatThreadId: `thread-${i}`
        })
      )
    );
    
    // Rapidly switch between sessions
    for (let i = 0; i < 50; i++) {
      const session = sessions[i % sessions.length];
      const switchStart = performance.now();
      
      await sendTestMessage(session, {
        instruction: `Switch test ${i}`,
        commandId: `switch-${i}`
      });
      
      metrics.sessionSwitches.push(performance.now() - switchStart);
    }
    
    console.log('Session Switching Results:', {
      totalSwitches: 50,
      avgSwitchTime: `${average(metrics.sessionSwitches)}ms`,
      p50SwitchTime: `${percentile(metrics.sessionSwitches, 50)}ms`,
      p99SwitchTime: `${percentile(metrics.sessionSwitches, 99)}ms`
    });
    
    expect(average(metrics.sessionSwitches)).toBeLessThan(2000);
  });
});
```

### 2. Stress Testing

```typescript
// test/performance/stress-test.ts
describe('Stress Testing', () => {
  it('should handle message bursts', async () => {
    const session = await createTestSession({
      clientId: 'stresstest',
      projectId: 'burst-test',
      userId: 'test-user',
      chatThreadId: 'burst-thread'
    });
    
    // Send 100 messages as fast as possible
    const promises = Array.from({ length: 100 }, (_, i) =>
      sendTestMessage(session, {
        instruction: `Burst message ${i}`,
        commandId: `burst-${i}`
      })
    );
    
    const results = await Promise.allSettled(promises);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    
    expect(successful).toBeGreaterThan(90); // 90% success under stress
  });
  
  it('should handle container failures gracefully', async () => {
    const session = await createTestSession({
      clientId: 'stresstest',
      projectId: 'failure-test',
      userId: 'test-user',
      chatThreadId: 'failure-thread'
    });
    
    // Send message
    await sendTestMessage(session, {
      instruction: 'Initial message',
      commandId: 'init'
    });
    
    // Kill container
    await killTestContainer(session.containerId);
    
    // Send another message (should restart container)
    const startTime = performance.now();
    const response = await sendTestMessage(session, {
      instruction: 'After failure message',
      commandId: 'after-failure'
    });
    const recoveryTime = performance.now() - startTime;
    
    expect(response.success).toBe(true);
    expect(recoveryTime).toBeLessThan(60000); // Recovery within 1 minute
  });
});
```

### 3. Memory and Resource Testing

```typescript
// test/performance/resource-test.ts
describe('Resource Usage Testing', () => {
  it('should not leak memory during long sessions', async () => {
    const session = await createTestSession({
      clientId: 'memtest',
      projectId: 'memory-test',
      userId: 'test-user',
      chatThreadId: 'memory-thread'
    });
    
    const memorySnapshots: number[] = [];
    
    // Run for 30 minutes
    const endTime = Date.now() + 30 * 60 * 1000;
    let messageCount = 0;
    
    while (Date.now() < endTime) {
      // Send message
      await sendTestMessage(session, {
        instruction: `Memory test message ${messageCount++}`,
        commandId: `mem-${messageCount}`
      });
      
      // Check memory every 10 messages
      if (messageCount % 10 === 0) {
        const memory = await getContainerMemory(session.containerId);
        memorySnapshots.push(memory);
        
        console.log(`Memory after ${messageCount} messages: ${memory}MB`);
      }
      
      await sleep(5000); // 5 seconds between messages
    }
    
    // Analyze memory growth
    const initialMemory = memorySnapshots[0];
    const finalMemory = memorySnapshots[memorySnapshots.length - 1];
    const memoryGrowth = finalMemory - initialMemory;
    
    console.log('Memory Test Results:', {
      messages: messageCount,
      initialMemory: `${initialMemory}MB`,
      finalMemory: `${finalMemory}MB`,
      growth: `${memoryGrowth}MB`,
      avgMemory: `${average(memorySnapshots)}MB`
    });
    
    expect(finalMemory).toBeLessThan(1024); // Less than 1GB
    expect(memoryGrowth).toBeLessThan(100); // Less than 100MB growth
  });
});
```

## Optimization Strategies

### 1. Container Optimization

```typescript
// Optimize container startup
export class OptimizedContainer {
  // Pre-compile TypeScript
  private static readonly PRECOMPILED = true;
  
  // Cache npm dependencies in image
  private static readonly CACHED_DEPS = true;
  
  // Use lighter base image
  private static readonly BASE_IMAGE = 'node:18-alpine';
  
  async start() {
    // Parallel initialization
    await Promise.all([
      this.initGit(),
      this.startAstro(),
      this.connectQueues()
    ]);
  }
  
  // Lazy load heavy dependencies
  private async loadClaudeCode() {
    if (!this.claudeCode) {
      this.claudeCode = await import('@anthropic/claude-code');
    }
    return this.claudeCode;
  }
}
```

### 2. Queue Optimization

```typescript
// Batch message processing
export class BatchProcessor {
  async processBatch(messages: Message[]): Promise<void> {
    // Group messages by session
    const sessionGroups = this.groupBySession(messages);
    
    // Process each session's messages in order
    for (const [sessionId, sessionMessages] of sessionGroups) {
      await this.processSessionMessages(sessionId, sessionMessages);
    }
  }
  
  // Use FIFO queues for ordering
  async createFifoQueue(sessionId: string) {
    return this.sqs.send(new CreateQueueCommand({
      QueueName: `${sessionId}.fifo`,
      Attributes: {
        FifoQueue: 'true',
        ContentBasedDeduplication: 'true'
      }
    }));
  }
}
```

### 3. Caching Strategy

```typescript
// Implement caching layers
export class CacheManager {
  // Cache git operations
  private gitCache = new Map<string, GitStatus>();
  
  // Cache container lookups
  private containerCache = new LRUCache<string, ContainerInfo>({
    max: 100,
    ttl: 60000 // 1 minute
  });
  
  // Cache session data
  private sessionCache = new Map<string, SessionData>();
  
  async getContainer(containerId: string): Promise<ContainerInfo> {
    // Check cache first
    if (this.containerCache.has(containerId)) {
      return this.containerCache.get(containerId)!;
    }
    
    // Fetch from DynamoDB
    const container = await this.fetchContainer(containerId);
    this.containerCache.set(containerId, container);
    return container;
  }
}
```

## Performance Monitoring

```typescript
// Real-time performance monitoring
export class PerformanceMonitor {
  private metrics = new Map<string, number[]>();
  
  recordMetric(name: string, value: number) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(value);
    
    // Send to CloudWatch
    this.publishMetric(name, value);
  }
  
  async publishMetric(name: string, value: number) {
    await this.cloudWatch.send(new PutMetricDataCommand({
      Namespace: 'Webordinary/Performance',
      MetricData: [{
        MetricName: name,
        Value: value,
        Unit: 'Milliseconds',
        Timestamp: new Date()
      }]
    }));
  }
  
  getStats(name: string): Stats {
    const values = this.metrics.get(name) || [];
    return {
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: average(values),
      p50: percentile(values, 50),
      p90: percentile(values, 90),
      p99: percentile(values, 99)
    };
  }
}
```

## Success Criteria
- [ ] All performance targets met
- [ ] 95% success rate under load
- [ ] Memory usage stable over time
- [ ] Container startup < 30 seconds
- [ ] Message processing < 5 seconds (p50)
- [ ] System recovers from failures

## Testing Environment
- Use dedicated AWS account for testing
- Deploy identical infrastructure
- Use production-like data volumes
- Monitor all metrics during tests
- Generate performance reports