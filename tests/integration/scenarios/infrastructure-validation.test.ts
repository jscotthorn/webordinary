/**
 * Infrastructure Validation Test Suite
 * 
 * This test suite validates that the integration test infrastructure
 * is properly set up and can communicate with AWS services.
 */

import { TestDataManager } from '../src/test-data-manager.js';
import { testUtils } from '../src/setup-tests.js';
// Use built-in fetch for Node.js 18+
const fetch = globalThis.fetch;

describe('Infrastructure Validation', () => {
  let testDataManager: TestDataManager;

  beforeAll(() => {
    testDataManager = new TestDataManager();
  });

  afterAll(async () => {
    await testDataManager.cleanup();
  });

  describe('AWS Service Connectivity', () => {
    test('should connect to ECS service', async () => {
      const editServiceStatus = await global.awsServices.ecs.getServiceStatus(
        global.testConfig.services.editService
      );

      expect(editServiceStatus).toBeDefined();
      expect(editServiceStatus.runningCount).toBeGreaterThanOrEqual(0);
      expect(editServiceStatus.desiredCount).toBeGreaterThanOrEqual(0);
      expect(editServiceStatus.status).toBe('ACTIVE');

      console.log(`✅ ECS Edit Service: ${editServiceStatus.runningCount}/${editServiceStatus.desiredCount} tasks`);
    });

    test('should connect to Hermes service', async () => {
      const hermesServiceStatus = await global.awsServices.ecs.getServiceStatus(
        global.testConfig.services.hermesService
      );

      expect(hermesServiceStatus).toBeDefined();
      expect(hermesServiceStatus.runningCount).toBeGreaterThanOrEqual(0);
      expect(hermesServiceStatus.desiredCount).toBeGreaterThanOrEqual(0);
      expect(hermesServiceStatus.status).toBe('ACTIVE');

      console.log(`✅ ECS Hermes Service: ${hermesServiceStatus.runningCount}/${hermesServiceStatus.desiredCount} tasks`);
    });

    test('should connect to DynamoDB table', async () => {
      const testSessions = await global.awsServices.dynamo.scanTestSessions();

      expect(testSessions).toBeDefined();
      expect(Array.isArray(testSessions)).toBe(true);

      console.log(`✅ DynamoDB scan successful, found ${testSessions.length} test sessions`);
    });

    test('should connect to CloudWatch', async () => {
      const activeSessionMetric = await global.awsServices.cloudWatch.getActiveSessionMetric();

      expect(activeSessionMetric).toBeDefined();
      expect(typeof activeSessionMetric).toBe('number');
      expect(activeSessionMetric).toBeGreaterThanOrEqual(0);

      console.log(`✅ CloudWatch metric retrieved: ${activeSessionMetric} active sessions`);
    });
  });

  describe('Test Harness Functionality', () => {
    test('should initialize test harness', () => {
      expect(global.testHarness).toBeDefined();
      expect(global.testHarness.createTestSession).toBeDefined();
      expect(global.testHarness.waitForContainerReady).toBeDefined();
      expect(global.testHarness.cleanup).toBeDefined();
    });

    test('should generate test session parameters', () => {
      const sessionParams = testDataManager.generateSessionParams();

      expect(sessionParams.clientId).toBe(global.testConfig.testData.clientId);
      expect(sessionParams.userId).toMatch(/user-\w+@test\.com/);
      expect(sessionParams.instruction).toBeTruthy();
      expect(sessionParams.metadata?.testRunId).toBeTruthy();
    });

    test('should generate realistic test instructions', () => {
      const simpleInstruction = testDataManager.generateTestInstruction('simple');
      const complexInstruction = testDataManager.generateTestInstruction('complex');
      const componentInstruction = testDataManager.generateTestInstruction('component');

      expect(simpleInstruction).toBeTruthy();
      expect(complexInstruction).toBeTruthy();
      expect(componentInstruction).toBeTruthy();

      expect(simpleInstruction.length).toBeGreaterThan(10);
      expect(complexInstruction.length).toBeGreaterThan(simpleInstruction.length);
      
      console.log(`✅ Generated test instructions:`);
      console.log(`  Simple: "${simpleInstruction}"`);
      console.log(`  Complex: "${complexInstruction}"`);
      console.log(`  Component: "${componentInstruction}"`);
    });

    test('should create test workspace structure', () => {
      const workspace = testDataManager.createTestWorkspaceStructure();

      expect(workspace.files).toBeDefined();
      expect(workspace.directories).toBeDefined();
      expect(workspace.files['package.json']).toBeTruthy();
      expect(workspace.files['astro.config.mjs']).toBeTruthy();
      expect(workspace.directories).toContain('src');
      expect(workspace.directories).toContain('src/pages');
      
      console.log(`✅ Test workspace structure created with ${Object.keys(workspace.files).length} files and ${workspace.directories.length} directories`);
    });
  });

  describe('ALB Endpoint Connectivity', () => {
    test('should reach ALB health check endpoint', async () => {
      const healthUrl = `${global.testConfig.endpoints.alb}/health`;
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(healthUrl, {
          headers: {
            'User-Agent': 'webordinary-integration-test-infrastructure-validation'
          },
          signal: controller.signal,
          // @ts-ignore - Allow self-signed or mismatched certificates for testing
          agent: new (await import('https')).Agent({
            rejectUnauthorized: false
          })
        });
        
        clearTimeout(timeoutId);

        // We expect this might return 404 or 503 if no services are running
        // The important thing is that we get a response from the ALB
        expect([200, 404, 503, 502]).toContain(response.status);
        
        console.log(`✅ ALB health check responded with status: ${response.status}`);
      } catch (error) {
        if (error instanceof Error && error.message.includes('timeout')) {
          throw new Error('ALB endpoint is not reachable - check network connectivity');
        }
        throw error;
      }
    });

    test('should validate ALB endpoints configuration', () => {
      expect(global.testConfig.endpoints.alb).toMatch(/^https:\/\/.+/);
      expect(global.testConfig.endpoints.hermes).toMatch(/^https:\/\/.+\/hermes$/);
      expect(global.testConfig.endpoints.api).toMatch(/^https:\/\/.+\/api$/);

      console.log(`✅ ALB endpoints configured:`);
      console.log(`  ALB: ${global.testConfig.endpoints.alb}`);
      console.log(`  Hermes: ${global.testConfig.endpoints.hermes}`);
      console.log(`  API: ${global.testConfig.endpoints.api}`);
    });
  });

  describe('Test Utility Functions', () => {
    test('should provide working utility functions', async () => {
      // Test sleep utility
      const startTime = Date.now();
      await testUtils.sleep(100);
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(90); // Allow for some timing variance

      // Test unique ID generation
      const id1 = testUtils.generateUniqueId('test');
      const id2 = testUtils.generateUniqueId('test');
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^test-\d+-\w+$/);

      // Test duration formatting
      expect(testUtils.formatDuration(500)).toBe('500ms');
      expect(testUtils.formatDuration(1500)).toBe('1s');
      expect(testUtils.formatDuration(65000)).toBe('1m 5s');

      // Test cost calculation
      const cost = testUtils.calculateCost(60000, 'edit'); // 1 minute
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(1); // Should be much less than $1 for 1 minute

      console.log(`✅ Test utilities working correctly`);
    });

    test('should provide retry functionality', async () => {
      let attempts = 0;
      
      const result = await testUtils.retry(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Simulated failure');
        }
        return 'success';
      }, 3, 10); // Very short delay for testing

      expect(result).toBe('success');
      expect(attempts).toBe(2);

      console.log(`✅ Retry utility worked with ${attempts} attempts`);
    });
  });

  describe('Configuration Validation', () => {
    test('should have valid AWS configuration', () => {
      expect(global.testConfig.aws.region).toBeTruthy();
      expect(global.testConfig.aws.account).toMatch(/^\d{12}$/);
      expect(global.testConfig.aws.profile).toBeTruthy();

      console.log(`✅ AWS Configuration:`);
      console.log(`  Region: ${global.testConfig.aws.region}`);
      console.log(`  Account: ${global.testConfig.aws.account}`);
      console.log(`  Profile: ${global.testConfig.aws.profile}`);
    });

    test('should have valid service configuration', () => {
      expect(global.testConfig.services.clusterName).toBeTruthy();
      expect(global.testConfig.services.hermesService).toBeTruthy();
      expect(global.testConfig.services.editService).toBeTruthy();
      expect(global.testConfig.services.dynamoTableName).toBeTruthy();

      console.log(`✅ Service Configuration:`);
      console.log(`  Cluster: ${global.testConfig.services.clusterName}`);
      console.log(`  Hermes Service: ${global.testConfig.services.hermesService}`);
      console.log(`  Edit Service: ${global.testConfig.services.editService}`);
      console.log(`  DynamoDB Table: ${global.testConfig.services.dynamoTableName}`);
    });

    test('should have reasonable timeout values', () => {
      expect(global.testConfig.timeouts.containerReady).toBeGreaterThan(30000); // At least 30s
      expect(global.testConfig.timeouts.containerReady).toBeLessThan(300000); // Less than 5m
      expect(global.testConfig.timeouts.testTimeout).toBeGreaterThan(120000); // At least 2m
      expect(global.testConfig.timeouts.sessionExpiry).toBeGreaterThan(60000); // At least 1m

      console.log(`✅ Timeout Configuration:`);
      console.log(`  Container Ready: ${testUtils.formatDuration(global.testConfig.timeouts.containerReady)}`);
      console.log(`  Test Timeout: ${testUtils.formatDuration(global.testConfig.timeouts.testTimeout)}`);
      console.log(`  Session Expiry: ${testUtils.formatDuration(global.testConfig.timeouts.sessionExpiry)}`);
    });
  });

  describe('Performance Baseline', () => {
    test('should measure baseline AWS API response times', async () => {
      const operations = [
        { name: 'ECS describe services', operation: () => global.awsServices.ecs.getServiceStatus(global.testConfig.services.editService) },
        { name: 'DynamoDB scan', operation: () => global.awsServices.dynamo.scanTestSessions() },
        { name: 'CloudWatch get metric', operation: () => global.awsServices.cloudWatch.getActiveSessionMetric() }
      ];

      for (const { name, operation } of operations) {
        const startTime = Date.now();
        await operation();
        const duration = Date.now() - startTime;
        
        expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
        console.log(`✅ ${name}: ${duration}ms`);
      }
    });
  });
});

// Export for potential standalone usage
export default {};