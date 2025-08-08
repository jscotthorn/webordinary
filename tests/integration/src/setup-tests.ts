import { validateTestConfig, TEST_CONFIG } from '../config/test-config.js';
import { AWSServiceManager } from './aws-service-clients.js';
import { IntegrationTestHarness } from './integration-test-harness.js';

declare global {
  var testHarness: IntegrationTestHarness;
  var awsServices: AWSServiceManager;
  var testConfig: typeof TEST_CONFIG;
}

/**
 * Global test setup - runs once before all tests
 */
beforeAll(async () => {
  console.log('🚀 Setting up integration test environment...');

  // Validate test configuration
  try {
    validateTestConfig();
    console.log('✅ Test configuration validated');
  } catch (error) {
    console.error('❌ Test configuration invalid:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }

  // Initialize global test utilities
  global.testHarness = new IntegrationTestHarness();
  global.awsServices = new AWSServiceManager();
  global.testConfig = TEST_CONFIG;

  // Perform AWS service health checks
  try {
    const healthChecks = await global.awsServices.healthCheck();
    const unhealthyServices = healthChecks.filter(check => !check.healthy);
    
    if (unhealthyServices.length > 0) {
      console.error('❌ Some AWS services are not healthy:');
      unhealthyServices.forEach(service => {
        console.error(`  - ${service.service}: ${service.details || 'Unknown error'}`);
      });
      
      // Don't exit - tests might still be able to run with partial service availability
      console.warn('⚠️  Continuing with degraded service availability');
    } else {
      console.log('✅ All AWS services are healthy');
    }
  } catch (error) {
    console.error('❌ Failed to check AWS service health:', error instanceof Error ? error.message : 'Unknown error');
    console.warn('⚠️  Continuing without health check verification');
  }

  // Verify that services are scaled to zero initially
  try {
    const editServiceCount = await global.awsServices.ecs.getServiceStatus(TEST_CONFIG.services.editService);
    const hermesServiceCount = await global.awsServices.ecs.getServiceStatus(TEST_CONFIG.services.hermesService);
    
    console.log(`📊 Initial service status:`);
    console.log(`  - Edit service: ${editServiceCount.runningCount}/${editServiceCount.desiredCount} tasks`);
    console.log(`  - Hermes service: ${hermesServiceCount.runningCount}/${hermesServiceCount.desiredCount} tasks`);
    
    // Scale down if not already at zero (cleanup from previous tests)
    if (editServiceCount.runningCount > 0) {
      console.log('🔧 Scaling down edit service from previous tests...');
      await global.awsServices.ecs.updateServiceTaskCount(TEST_CONFIG.services.editService, 0);
      await global.awsServices.ecs.waitForServiceStable(TEST_CONFIG.services.editService);
    }
    
    // Don't scale down Hermes automatically - it might be needed for other operations
    
  } catch (error) {
    console.error('❌ Failed to check initial service status:', error instanceof Error ? error.message : 'Unknown error');
    console.warn('⚠️  Continuing without initial service verification');
  }

  // Clean up any leftover test sessions from previous runs
  try {
    const testSessions = await global.awsServices.dynamo.scanTestSessions();
    if (testSessions.length > 0) {
      console.log(`🧹 Cleaning up ${testSessions.length} leftover test sessions...`);
      await global.awsServices.dynamo.batchDeleteSessions(
        testSessions.map(session => ({ sessionId: session.sessionId, userId: session.userId }))
      );
      console.log('✅ Cleanup completed');
    }
  } catch (error) {
    console.warn('⚠️  Failed to clean up leftover sessions:', error instanceof Error ? error.message : 'Unknown error');
  }

  console.log('✅ Integration test environment setup complete\n');
}, 60000); // 60 second timeout for setup

/**
 * Global test cleanup - runs once after all tests
 */
afterAll(async () => {
  console.log('\n🧹 Cleaning up integration test environment...');

  try {
    await global.testHarness.cleanup();
    console.log('✅ Test harness cleanup completed');
  } catch (error) {
    console.error('❌ Test harness cleanup failed:', error instanceof Error ? error.message : 'Unknown error');
  }

  // Final service status check
  try {
    const editServiceCount = await global.awsServices.ecs.getServiceStatus(TEST_CONFIG.services.editService);
    console.log(`📊 Final edit service status: ${editServiceCount.runningCount}/${editServiceCount.desiredCount} tasks`);
    
    if (editServiceCount.runningCount > 0) {
      console.log('🔧 Final cleanup: Scaling edit service to zero...');
      await global.awsServices.ecs.updateServiceTaskCount(TEST_CONFIG.services.editService, 0);
    }
  } catch (error) {
    console.warn('⚠️  Failed final service cleanup:', error instanceof Error ? error.message : 'Unknown error');
  }

  console.log('✅ Integration test environment cleanup complete');
}, 60000); // 60 second timeout for cleanup

/**
 * Individual test setup - runs before each test
 */
beforeEach(() => {
  // Timeout is set in package.json Jest config
});

/**
 * Individual test cleanup - runs after each test
 */
afterEach(async () => {
  // Brief pause to allow services to settle between tests
  await new Promise(resolve => setTimeout(resolve, 1000));
});

/**
 * Custom matchers for integration testing
 */
expect.extend({
  toBeWithinTimeout(received: number, expected: number) {
    const pass = received <= expected;
    return {
      message: () => pass 
        ? `Expected ${received}ms to exceed timeout ${expected}ms`
        : `Expected ${received}ms to be within timeout ${expected}ms`,
      pass
    };
  },

  toHaveSuccessRate(received: { passed: number; total: number }, expectedRate: number) {
    const actualRate = received.total > 0 ? (received.passed / received.total) * 100 : 0;
    const pass = actualRate >= expectedRate;
    return {
      message: () => pass
        ? `Expected success rate ${actualRate.toFixed(1)}% to be below ${expectedRate}%`
        : `Expected success rate ${actualRate.toFixed(1)}% to be at least ${expectedRate}%`,
      pass
    };
  },

  toBeHealthy(received: { healthy: boolean; details?: string }) {
    return {
      message: () => received.healthy
        ? 'Expected service to be unhealthy'
        : `Expected service to be healthy, but got: ${received.details || 'Unknown error'}`,
      pass: received.healthy
    };
  }
});

// Extend Jest matchers interface
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeWithinTimeout(timeout: number): R;
      toHaveSuccessRate(expectedRate: number): R;
      toBeHealthy(): R;
    }
  }
}

// Export test utilities for use in test files
export const testUtils = {
  sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  
  retry: async <T>(
    operation: () => Promise<T>, 
    maxAttempts = 3, 
    delayMs = 1000
  ): Promise<T> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxAttempts) {
          throw error;
        }
        console.warn(`Attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms...`);
        await testUtils.sleep(delayMs);
        delayMs *= 2; // Exponential backoff
      }
    }
    throw new Error('Max attempts reached'); // This should never be reached
  },

  waitForCondition: async (
    condition: () => Promise<boolean>,
    timeoutMs = 30000,
    intervalMs = 1000
  ): Promise<void> => {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (await condition()) {
        return;
      }
      await testUtils.sleep(intervalMs);
    }
    
    throw new Error(`Condition not met within ${timeoutMs}ms`);
  },

  generateUniqueId: (prefix = 'test'): string => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
  },

  formatDuration: (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  },

  calculateCost: (durationMs: number, containerType: 'hermes' | 'edit' = 'edit'): number => {
    // Rough cost calculation based on Fargate pricing
    const hourlyRates = {
      hermes: 0.027, // 0.5 vCPU, 1GB RAM
      edit: 0.081    // 2 vCPU, 4GB RAM
    };
    
    const hours = durationMs / (1000 * 60 * 60);
    return hours * hourlyRates[containerType];
  }
};

console.log('📋 Integration test setup loaded');