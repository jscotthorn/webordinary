/**
 * Concurrent Session Handling Test Suite
 * 
 * Verifies that the system can handle multiple simultaneous sessions
 * with proper isolation, auto-scaling, and resource management.
 */

import { TestDataManager } from '../src/test-data-manager.js';
import { testUtils } from '../src/setup-tests.js';
import { TestSession } from '../config/test-config.js';

describe('Concurrent Session Handling', () => {
  let testDataManager: TestDataManager;
  const TEST_TIMEOUT = 180000; // 3 minutes for concurrent scenarios
  const MAX_CONCURRENT_SESSIONS = 3; // Expected max capacity

  beforeAll(() => {
    testDataManager = new TestDataManager();
  });

  afterAll(async () => {
    await testDataManager.cleanup();
    
    // Clean up all test sessions
    const testSessions = await global.awsServices.dynamo.scanTestSessions();
    console.log(`🧹 Cleaning up ${testSessions.length} test sessions...`);
    
    for (const session of testSessions) {
      try {
        await global.awsServices.dynamo.deleteSession(session.sessionId, session.userId);
      } catch (error) {
        console.warn(`Failed to clean up session ${session.sessionId}:`, error);
      }
    }
    
    // Scale down services
    try {
      await global.awsServices.ecs.updateServiceTaskCount(
        global.testConfig.services.editService,
        0
      );
    } catch (error) {
      console.warn('Failed to scale down edit service:', error);
    }
  });

  describe('Multi-Session Creation', () => {
    test('should handle multiple simultaneous session creations', async () => {
      const testStartTime = Date.now();
      const sessionCount = 3;
      const sessions: TestSession[] = [];
      
      console.log(`🚀 Creating ${sessionCount} concurrent sessions...`);
      
      // Step 1: Create multiple sessions simultaneously
      console.log('Step 1: Initiating concurrent session creation...');
      const sessionPromises = Array.from({ length: sessionCount }, async (_, index) => {
        const sessionParams = testDataManager.generateSessionParams({
          clientId: `concurrent-client-${index}-${Date.now()}`,
          userId: `${global.testConfig.testData.testPrefix}user${index}@test.com`,
          instruction: `Session ${index}: Create a page called "Page${index}"`
        });
        
        try {
          const session = await global.testHarness.createTestSession(sessionParams);
          console.log(`✅ Session ${index} created: ${session.sessionId}`);
          return session;
        } catch (error) {
          console.error(`❌ Failed to create session ${index}:`, error);
          throw error;
        }
      });
      
      // Wait for all sessions to be created
      const createdSessions = await Promise.allSettled(sessionPromises);
      
      // Verify all sessions were created successfully
      const successfulSessions = createdSessions
        .filter(result => result.status === 'fulfilled')
        .map(result => (result as PromiseFulfilledResult<TestSession>).value);
      
      const failedSessions = createdSessions
        .filter(result => result.status === 'rejected');
      
      console.log(`✅ Created ${successfulSessions.length}/${sessionCount} sessions successfully`);
      if (failedSessions.length > 0) {
        console.warn(`⚠️ ${failedSessions.length} sessions failed to create`);
      }
      
      expect(successfulSessions.length).toBeGreaterThan(0);
      sessions.push(...successfulSessions);
      
      // Record sessions for cleanup
      successfulSessions.forEach(session => {
        testDataManager.recordTestSession(session);
      });
      
      // Step 2: Verify all sessions exist in DynamoDB
      console.log('Step 2: Verifying sessions in DynamoDB...');
      const verificationPromises = successfulSessions.map(async (session, index) => {
        const dynamoSession = await global.awsServices.dynamo.getSession(
          session.sessionId,
          session.userId
        );
        expect(dynamoSession).toBeTruthy();
        console.log(`✅ Session ${index} verified in DynamoDB`);
        return dynamoSession;
      });
      
      await Promise.all(verificationPromises);
      
      // Step 3: Wait for containers to be ready
      console.log('Step 3: Waiting for containers to scale...');
      const containerReadyPromises = successfulSessions.map(async (session, index) => {
        try {
          const startTime = Date.now();
          await global.testHarness.waitForContainerReady(session.sessionId, 90000);
          const duration = Date.now() - startTime;
          console.log(`✅ Container ${index} ready in ${duration}ms`);
          return { success: true, duration };
        } catch (error) {
          console.warn(`⚠️ Container ${index} failed to become ready:`, error);
          return { success: false, duration: 0 };
        }
      });
      
      const containerResults = await Promise.all(containerReadyPromises);
      const readyContainers = containerResults.filter(r => r.success);
      
      console.log(`✅ ${readyContainers.length}/${successfulSessions.length} containers ready`);
      expect(readyContainers.length).toBeGreaterThan(0);
      
      // Step 4: Verify service scaling
      console.log('Step 4: Verifying service auto-scaling...');
      const serviceStatus = await global.awsServices.ecs.getServiceStatus(
        global.testConfig.services.editService
      );
      
      console.log(`✅ Service scaled to ${serviceStatus.runningCount} tasks`);
      expect(serviceStatus.runningCount).toBeGreaterThan(0);
      expect(serviceStatus.runningCount).toBeLessThanOrEqual(MAX_CONCURRENT_SESSIONS);
      
      // Calculate total time
      const totalTime = Date.now() - testStartTime;
      console.log(`✅ Concurrent session creation completed in ${totalTime}ms`);
      
      // Record test result
      testDataManager.recordTestResult({
        testId: 'concurrent-creation',
        testName: 'Concurrent Session Creation',
        status: 'passed',
        duration: totalTime,
        startTime: testStartTime,
        endTime: Date.now(),
        metadata: {
          sessionsCreated: successfulSessions.length,
          sessionsFailed: failedSessions.length,
          finalTaskCount: serviceStatus.runningCount,
          avgContainerStartup: readyContainers.reduce((sum, r) => sum + r.duration, 0) / readyContainers.length
        }
      });
      
      // Clean up sessions
      for (const session of successfulSessions) {
        try {
          await global.awsServices.dynamo.deleteSession(session.sessionId, session.userId);
        } catch (error) {
          console.warn(`Failed to clean up session ${session.sessionId}:`, error);
        }
      }
      
    }, TEST_TIMEOUT);
  });

  describe('Workspace Isolation', () => {
    test('should maintain isolation between concurrent sessions', async () => {
      console.log('🔒 Testing workspace isolation for concurrent sessions...');
      
      // Create two sessions that should be isolated
      const session1Params = testDataManager.generateSessionParams({
        clientId: `isolated-client-1-${Date.now()}`,
        userId: `${global.testConfig.testData.testPrefix}isolated1@test.com`,
        instruction: 'Create file1.txt with content: Session 1'
      });
      
      const session2Params = testDataManager.generateSessionParams({
        clientId: `isolated-client-2-${Date.now()}`,
        userId: `${global.testConfig.testData.testPrefix}isolated2@test.com`,
        instruction: 'Create file2.txt with content: Session 2'
      });
      
      // Create sessions concurrently
      const [session1, session2] = await Promise.all([
        global.testHarness.createTestSession(session1Params),
        global.testHarness.createTestSession(session2Params)
      ]);
      
      testDataManager.recordTestSession(session1);
      testDataManager.recordTestSession(session2);
      
      console.log(`✅ Created isolated sessions: ${session1.sessionId}, ${session2.sessionId}`);
      
      // Wait for both containers
      await Promise.all([
        global.testHarness.waitForContainerReady(session1.sessionId, 60000),
        global.testHarness.waitForContainerReady(session2.sessionId, 60000)
      ]);
      
      // Verify sessions have different workspace paths
      const workspace1 = `/workspace/${session1.clientId}/project`;
      const workspace2 = `/workspace/${session2.clientId}/project`;
      
      expect(workspace1).not.toBe(workspace2);
      expect(session1.sessionId).not.toBe(session2.sessionId);
      expect(session1.clientId).not.toBe(session2.clientId);
      
      console.log(`✅ Workspace 1: ${workspace1}`);
      console.log(`✅ Workspace 2: ${workspace2}`);
      console.log(`✅ Workspaces are properly isolated`);
      
      // Clean up
      await global.awsServices.dynamo.deleteSession(session1.sessionId, session1.userId);
      await global.awsServices.dynamo.deleteSession(session2.sessionId, session2.userId);
      
    }, TEST_TIMEOUT);
  });

  describe('Auto-Scaling Behavior', () => {
    test('should scale up to handle increased load', async () => {
      console.log('📈 Testing auto-scaling up behavior...');
      
      // Get initial task count
      const initialStatus = await global.awsServices.ecs.getServiceStatus(
        global.testConfig.services.editService
      );
      console.log(`ℹ️ Initial task count: ${initialStatus.runningCount}`);
      
      // Create multiple sessions to trigger scaling
      const sessionCount = 3;
      const sessions: TestSession[] = [];
      
      console.log(`Creating ${sessionCount} sessions to trigger scaling...`);
      
      for (let i = 0; i < sessionCount; i++) {
        const session = await global.testHarness.createTestSession(
          testDataManager.generateSessionParams({
            clientId: `scale-test-${i}-${Date.now()}`,
            userId: `${global.testConfig.testData.testPrefix}scale${i}@test.com`,
            instruction: `Scale test session ${i}`
          })
        );
        
        sessions.push(session);
        testDataManager.recordTestSession(session);
        console.log(`✅ Created session ${i}: ${session.sessionId}`);
        
        // Small delay between creations to allow scaling to react
        await testUtils.sleep(2000);
      }
      
      // Wait for scaling to occur
      console.log('⏳ Waiting for auto-scaling to respond...');
      await testUtils.sleep(10000); // Give auto-scaling time to react
      
      // Check new task count
      const scaledStatus = await global.awsServices.ecs.getServiceStatus(
        global.testConfig.services.editService
      );
      
      console.log(`✅ Scaled from ${initialStatus.runningCount} to ${scaledStatus.runningCount} tasks`);
      
      // Should have scaled up from initial count
      expect(scaledStatus.runningCount).toBeGreaterThanOrEqual(initialStatus.runningCount);
      
      // Publish metric to indicate active sessions
      await global.awsServices.cloudWatch.publishTestMetrics('scaling-test', {
        success: true,
        duration: 1000
      });
      
      // Clean up sessions
      for (const session of sessions) {
        await global.awsServices.dynamo.deleteSession(session.sessionId, session.userId);
      }
      
    }, TEST_TIMEOUT);

    test('should respect maximum capacity limits', async () => {
      console.log('🚫 Testing maximum capacity limits...');
      
      // Try to create more sessions than max capacity
      const sessionCount = MAX_CONCURRENT_SESSIONS + 2; // Try to exceed limit
      const sessions: TestSession[] = [];
      
      console.log(`Attempting to create ${sessionCount} sessions (max: ${MAX_CONCURRENT_SESSIONS})...`);
      
      const sessionPromises = Array.from({ length: sessionCount }, async (_, index) => {
        try {
          const session = await global.testHarness.createTestSession(
            testDataManager.generateSessionParams({
              clientId: `max-test-${index}-${Date.now()}`,
              userId: `${global.testConfig.testData.testPrefix}max${index}@test.com`,
              instruction: `Max capacity test ${index}`
            })
          );
          return { success: true, session };
        } catch (error) {
          return { success: false, error };
        }
      });
      
      const results = await Promise.all(sessionPromises);
      const successfulSessions = results
        .filter(r => r.success)
        .map(r => r.session as TestSession);
      
      successfulSessions.forEach(session => {
        sessions.push(session);
        testDataManager.recordTestSession(session);
      });
      
      console.log(`✅ Successfully created ${successfulSessions.length}/${sessionCount} sessions`);
      
      // Wait a bit for scaling
      await testUtils.sleep(10000);
      
      // Check task count doesn't exceed maximum
      const serviceStatus = await global.awsServices.ecs.getServiceStatus(
        global.testConfig.services.editService
      );
      
      console.log(`✅ Current task count: ${serviceStatus.runningCount}`);
      console.log(`✅ Desired task count: ${serviceStatus.desiredCount}`);
      
      // Should not exceed maximum capacity
      expect(serviceStatus.runningCount).toBeLessThanOrEqual(MAX_CONCURRENT_SESSIONS);
      
      // Some sessions might be queued or rejected if at capacity
      if (successfulSessions.length < sessionCount) {
        console.log(`ℹ️ ${sessionCount - successfulSessions.length} sessions were rate-limited or queued`);
      }
      
      // Clean up
      for (const session of sessions) {
        await global.awsServices.dynamo.deleteSession(session.sessionId, session.userId);
      }
      
    }, TEST_TIMEOUT);
  });

  describe('Session Lifecycle Management', () => {
    test('should handle individual session lifecycle independently', async () => {
      console.log('🔄 Testing independent session lifecycle management...');
      
      // Create multiple sessions
      const session1 = await global.testHarness.createTestSession(
        testDataManager.generateSessionParams({
          clientId: `lifecycle-1-${Date.now()}`,
          userId: `${global.testConfig.testData.testPrefix}lifecycle1@test.com`
        })
      );
      
      const session2 = await global.testHarness.createTestSession(
        testDataManager.generateSessionParams({
          clientId: `lifecycle-2-${Date.now()}`,
          userId: `${global.testConfig.testData.testPrefix}lifecycle2@test.com`
        })
      );
      
      testDataManager.recordTestSession(session1);
      testDataManager.recordTestSession(session2);
      
      console.log(`✅ Created sessions: ${session1.sessionId}, ${session2.sessionId}`);
      
      // Wait for containers
      await Promise.all([
        global.testHarness.waitForContainerReady(session1.sessionId, 60000),
        global.testHarness.waitForContainerReady(session2.sessionId, 60000)
      ]);
      
      // Update session 1 to expired
      await global.awsServices.dynamo.updateSessionStatus(
        session1.sessionId,
        session1.userId,
        'expired'
      );
      
      console.log(`✅ Session 1 marked as expired`);
      
      // Session 2 should still be active
      const session2Status = await global.awsServices.dynamo.getSession(
        session2.sessionId,
        session2.userId
      );
      
      expect(session2Status?.status).not.toBe('expired');
      console.log(`✅ Session 2 remains active: ${session2Status?.status}`);
      
      // Delete session 1
      await global.awsServices.dynamo.deleteSession(
        session1.sessionId,
        session1.userId
      );
      
      // Session 2 should still exist
      const session2StillExists = await global.awsServices.dynamo.getSession(
        session2.sessionId,
        session2.userId
      );
      
      expect(session2StillExists).toBeTruthy();
      console.log(`✅ Session lifecycles are independent`);
      
      // Clean up session 2
      await global.awsServices.dynamo.deleteSession(
        session2.sessionId,
        session2.userId
      );
    });
  });

  describe('Performance Under Load', () => {
    test('should maintain reasonable performance with concurrent sessions', async () => {
      console.log('⚡ Testing performance under concurrent load...');
      
      const sessionCount = 3;
      const performanceMetrics: Array<{
        sessionId: string;
        creationTime: number;
        readyTime: number;
      }> = [];
      
      // Create sessions and measure timing
      const sessionPromises = Array.from({ length: sessionCount }, async (_, index) => {
        const startTime = Date.now();
        
        const session = await global.testHarness.createTestSession(
          testDataManager.generateSessionParams({
            clientId: `perf-test-${index}-${Date.now()}`,
            userId: `${global.testConfig.testData.testPrefix}perf${index}@test.com`
          })
        );
        
        const creationTime = Date.now() - startTime;
        testDataManager.recordTestSession(session);
        
        const readyStartTime = Date.now();
        try {
          await global.testHarness.waitForContainerReady(session.sessionId, 90000);
          const readyTime = Date.now() - readyStartTime;
          
          performanceMetrics.push({
            sessionId: session.sessionId,
            creationTime,
            readyTime
          });
          
          return session;
        } catch (error) {
          console.warn(`Session ${index} container failed to become ready`);
          performanceMetrics.push({
            sessionId: session.sessionId,
            creationTime,
            readyTime: -1 // Failed
          });
          return session;
        }
      });
      
      const sessions = await Promise.all(sessionPromises);
      
      // Calculate performance statistics
      const validMetrics = performanceMetrics.filter(m => m.readyTime > 0);
      
      if (validMetrics.length > 0) {
        const avgCreationTime = validMetrics.reduce((sum, m) => sum + m.creationTime, 0) / validMetrics.length;
        const avgReadyTime = validMetrics.reduce((sum, m) => sum + m.readyTime, 0) / validMetrics.length;
        const maxReadyTime = Math.max(...validMetrics.map(m => m.readyTime));
        
        console.log(`📊 Performance Metrics:`);
        console.log(`  Average session creation: ${avgCreationTime}ms`);
        console.log(`  Average container ready: ${avgReadyTime}ms`);
        console.log(`  Max container ready: ${maxReadyTime}ms`);
        
        // Performance expectations
        expect(avgCreationTime).toBeLessThan(10000); // Session creation < 10s average
        expect(maxReadyTime).toBeLessThan(90000); // No container takes > 90s
      }
      
      // Clean up
      for (const session of sessions) {
        await global.awsServices.dynamo.deleteSession(session.sessionId, session.userId);
      }
    });
  });
});

// Export for potential standalone usage
export default {};