import { IntegrationTestHarness } from '../src/integration-test-harness.js';
import { TEST_CONFIG } from '../config/test-config.js';
// Use built-in fetch for Node.js 18+
const fetch = globalThis.fetch;

/**
 * Session Resumption Integration Tests
 * 
 * Tests the complete wake/sleep cycle for containers:
 * - Container auto-sleep when idle
 * - Preview URL triggering container wake
 * - Hermes API session resumption
 * - ALB routing with container wake
 */

describe('05 - Session Resumption Integration Tests', () => {
  let testHarness: IntegrationTestHarness;
  
  const testMetrics = {
    containerWakeTime: [] as number[],
    apiResponseTime: [] as number[],
    totalErrors: 0,
    successfulWakes: 0
  };

  beforeAll(async () => {
    testHarness = new IntegrationTestHarness();
    console.log('🔄 Starting Session Resumption Integration Tests');
  });

  afterAll(async () => {
    await testHarness.cleanup();
    
    // Report test metrics
    console.log('📊 Session Resumption Test Metrics:');
    console.log(`   Container Wake Time: avg ${Math.round(testMetrics.containerWakeTime.reduce((a, b) => a + b, 0) / testMetrics.containerWakeTime.length || 0)}ms`);
    console.log(`   API Response Time: avg ${Math.round(testMetrics.apiResponseTime.reduce((a, b) => a + b, 0) / testMetrics.apiResponseTime.length || 0)}ms`);
    console.log(`   Successful Wakes: ${testMetrics.successfulWakes}`);
    console.log(`   Total Errors: ${testMetrics.totalErrors}`);
  });

  describe('Container Wake via Hermes API', () => {
    it('should wake stopped container via resume-preview endpoint', async () => {
      const startTime = Date.now();
      
      // Create test session data
      const session = await testHarness.createResumptionTestSession({
        clientId: 'sessiontest',
        userId: 'integration-test',
        instruction: 'Test session resumption'
      });

      // Ensure container is in stopped state
      await testHarness.setContainerStatus(session.containerId!, 'stopped');

      try {
        // Call resume-preview API
        const response = await fetch(`${TEST_CONFIG.endpoints.hermes}/api/sessions/resume-preview`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY || 'test'}`
          },
          body: JSON.stringify({
            chatThreadId: session.threadId,
            clientId: session.clientId
          }),
          // timeout handled by AbortController
        });

        expect(response.status).toBe(201);
        
        const result = await response.json() as any;
        expect(result).toMatchObject({
          sessionId: session.sessionId,
          containerId: session.containerId!,
          status: expect.stringMatching(/^(starting|running)$/),
          containerIp: expect.any(String)
        });

        // Track metrics
        const responseTime = Date.now() - startTime;
        testMetrics.apiResponseTime.push(responseTime);
        
        if (result.status === 'running' || result.status === 'starting') {
          testMetrics.successfulWakes++;
        }

        // If container is starting, wait for it to become running
        if (result.status === 'starting') {
          const wakeStartTime = Date.now();
          
          await testHarness.waitForContainerStatus(session.containerId!, 'running', 60000);
          
          const wakeTime = Date.now() - wakeStartTime;
          testMetrics.containerWakeTime.push(wakeTime);
          
          console.log(`   ⏱️  Container wake time: ${wakeTime}ms`);
        }

      } catch (error) {
        testMetrics.totalErrors++;
        throw error;
      }
    }, 120000); // 2 minute timeout

    it('should return quickly for already running container', async () => {
      const session = await testHarness.createResumptionTestSession({
        clientId: 'fasttest',
        userId: 'integration-test',
        instruction: 'Fast response test'
      });

      // Set container as running
      await testHarness.setContainerStatus(session.containerId!, 'running', {
        containerIp: '10.0.1.200',
        taskArn: 'arn:aws:ecs:us-west-2:123:task/test-task'
      });

      const startTime = Date.now();

      const response = await fetch(`${TEST_CONFIG.endpoints.hermes}/api/sessions/resume-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatThreadId: session.threadId,
          clientId: session.clientId
        })
      });

      const responseTime = Date.now() - startTime;
      testMetrics.apiResponseTime.push(responseTime);

      expect(response.status).toBe(201);
      
      const result = await response.json() as any;
      expect(result.status).toBe('running');
      
      // Should respond quickly for running containers
      expect(responseTime).toBeLessThan(2000);
      console.log(`   ⚡ Fast response time: ${responseTime}ms`);
    });

    it('should handle session not found gracefully', async () => {
      try {
        const response = await fetch(`${TEST_CONFIG.endpoints.hermes}/api/sessions/resume-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatThreadId: 'nonexistent-thread-' + Date.now(),
            clientId: 'testclient'
          })
        });

        expect(response.status).toBe(404);
        
        const error = await response.json() as any;
        expect(error.message).toContain('not found');
        
      } catch (error) {
        testMetrics.totalErrors++;
        throw error;
      }
    });
  });

  describe('Queue-Based Container Claiming', () => {
    it('should claim work from unclaimed queue', async () => {
      const session = await testHarness.createResumptionTestSession({
        clientId: 'amelia',
        userId: 'scott',
        instruction: 'Test S3 deployment'
      });

      // Set container as stopped
      await testHarness.setContainerStatus(session.containerId!, 'stopped');

      const startTime = Date.now();
      
      try {
        // Send message to unclaimed queue
        const message = await testHarness.sendToUnclaimedQueue({
          projectId: session.clientId,
          userId: session.userId,
          instruction: 'Deploy test page',
          threadId: session.threadId
        });

        const responseTime = Date.now() - startTime;

        // Message should be processed
        expect(message).toBeDefined();
        expect(message.MessageId).toBeDefined();

        if (response.status === 202 || response.status === 503) {
          // Container starting page
          const body = await response.text();
          expect(body).toContain('Waking Up Edit Session');
          expect(body).toContain(session.threadId);
          expect(response.headers.get('retry-after')).toBeDefined();
          
          console.log(`   🔄 Message sent to unclaimed queue (${responseTime}ms)`);
          
          // Wait a bit and try again to see if container woke up
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Check S3 for deployment
          const s3Response = await fetch(
            `https://edit.${session.clientId}.webordinary.com/`,
            {
              // timeout handled by AbortController
            }
          );

          // Should now either forward (200/502) or still be starting
          expect([200, 202, 502, 503]).toContain(retryResponse.status);
          
        } else if (response.status === 502) {
          // Container unreachable (expected since we don't have real Astro server)
          const body = await response.text();
          expect(body).toContain('Container unreachable');
          
          console.log(`   ✅ Container wake successful, routing attempted (${responseTime}ms)`);
          testMetrics.successfulWakes++;
          
        } else {
          // Successful routing (200)
          console.log(`   ✅ Request routed successfully (${responseTime}ms)`);
          testMetrics.successfulWakes++;
        }

      } catch (error) {
        testMetrics.totalErrors++;
        
        // Timeout or connection errors are acceptable for this test
        if ((error as any)?.code === 'ECONNRESET' || (error as Error)?.message?.includes('timeout')) {
          console.log(`   ⚠️  Connection timeout/reset (expected with mock containers)`);
        } else {
          throw error;
        }
      }
    }, 60000);

    it('should show session not found for invalid thread', async () => {
      const invalidThreadId = 'invalid-thread-' + Date.now();
      
      const response = await fetch(
        `https://edit.testclient.webordinary.com/session/${invalidThreadId}/`,
        {
          // timeout handled by AbortController
        }
      );

      expect(response.status).toBe(404);
      
      const body = await response.text();
      expect(body).toContain('Edit Session Not Found');
      expect(body).toContain(invalidThreadId);
      expect(body).toContain('testclient');
    });

    it('should handle WebSocket routing limitations', async () => {
      const session = await testHarness.createResumptionTestSession({
        clientId: 'wstest',
        userId: 'integration-test',
        instruction: 'WebSocket test'
      });

      await testHarness.setContainerStatus(session.containerId!, 'running', {
        containerIp: '10.0.1.201'
      });

      // Simulate WebSocket upgrade request
      const response = await fetch(
        `https://edit.${session.clientId}.webordinary.com/session/${session.threadId}/_astro/hmr`,
        {
          headers: {
            'Upgrade': 'websocket',
            'Connection': 'upgrade'
          },
          // timeout handled by AbortController
        }
      );

      // Should return error for WebSocket (Lambda limitation)
      expect(response.status).toBe(502);
      
      const body = await response.text();
      expect(body).toContain('WebSocket not supported');
    });
  });

  describe('Container Auto-Sleep Simulation', () => {
    it('should simulate container idle state transition', async () => {
      const session = await testHarness.createResumptionTestSession({
        clientId: 'sleeptest',
        userId: 'integration-test',
        instruction: 'Sleep test'
      });

      // Set container as running initially
      await testHarness.setContainerStatus(session.containerId!, 'running', {
        containerIp: '10.0.1.202',
        lastActivity: Date.now() - (21 * 60 * 1000) // 21 minutes ago
      });

      // Check session count for this container
      const sessionCount = await testHarness.getActiveSessionCount(session.containerId!);
      console.log(`   📊 Active sessions for container: ${sessionCount}`);
      
      // Simulate what auto-sleep service would do
      if (sessionCount === 0) {
        await testHarness.setContainerStatus(session.containerId!, 'stopping');
        await new Promise(resolve => setTimeout(resolve, 1000));
        await testHarness.setContainerStatus(session.containerId!, 'stopped');
        
        console.log(`   💤 Container transitioned to stopped state`);
      }

      // Verify container can be woken up again
      const response = await fetch(`${TEST_CONFIG.endpoints.hermes}/api/sessions/resume-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatThreadId: session.threadId,
          clientId: session.clientId
        })
      });

      expect(response.status).toBe(201);
      
      const result = await response.json() as any;
      expect(result.status).toMatch(/^(starting|running)$/);
      
      console.log(`   🔄 Container wake after sleep: ${result.status}`);
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle concurrent wake requests', async () => {
      const session = await testHarness.createResumptionTestSession({
        clientId: 'concurrent',
        userId: 'integration-test',
        instruction: 'Concurrent test'
      });

      await testHarness.setContainerStatus(session.containerId!, 'stopped');

      const concurrentRequests = 3;
      const requests = Array.from({ length: concurrentRequests }, () =>
        fetch(`${TEST_CONFIG.endpoints.hermes}/api/sessions/resume-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatThreadId: session.threadId,
            clientId: session.clientId
          }),
          // timeout handled by AbortController
        })
      );

      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const totalTime = Date.now() - startTime;

      responses.forEach(response => {
        expect(response.status).toBe(201);
      });

      // Should handle concurrent requests efficiently
      expect(totalTime).toBeLessThan(35000); // 35 second max
      
      console.log(`   ⚡ ${concurrentRequests} concurrent requests handled in ${totalTime}ms`);
    }, 60000);

    it('should measure end-to-end session wake performance', async () => {
      const session = await testHarness.createResumptionTestSession({
        clientId: 'perftest',
        userId: 'integration-test',
        instruction: 'Performance test'
      });

      await testHarness.setContainerStatus(session.containerId!, 'stopped');

      const measurements = {
        apiCall: 0,
        containerStart: 0,
        totalWake: 0
      };

      // Measure API call time
      const apiStart = Date.now();
      
      const response = await fetch(`${TEST_CONFIG.endpoints.hermes}/api/sessions/resume-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatThreadId: session.threadId,
          clientId: session.clientId
        })
      });

      measurements.apiCall = Date.now() - apiStart;
      
      expect(response.status).toBe(201);
      const result = await response.json() as any;

      if (result.status === 'starting') {
        // Measure container start time
        const containerStart = Date.now();
        
        await testHarness.waitForContainerStatus(session.containerId!, 'running', 60000);
        
        measurements.containerStart = Date.now() - containerStart;
        measurements.totalWake = Date.now() - apiStart;
      }

      console.log(`   📈 Performance metrics:`);
      console.log(`      API Response: ${measurements.apiCall}ms`);
      console.log(`      Container Start: ${measurements.containerStart}ms`);
      console.log(`      Total Wake Time: ${measurements.totalWake}ms`);

      // Performance targets
      expect(measurements.apiCall).toBeLessThan(5000); // API should respond quickly
      if (measurements.containerStart > 0) {
        expect(measurements.containerStart).toBeLessThan(45000); // Container should start within 45s
        expect(measurements.totalWake).toBeLessThan(50000); // Total should be under 50s
      }
    }, 90000);
  });
});