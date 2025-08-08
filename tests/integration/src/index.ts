/**
 * Main entry point for Webordinary Integration Tests
 * 
 * This module provides the core testing infrastructure for end-to-end
 * integration testing of the Webordinary live-editing platform.
 */

export { IntegrationTestHarness } from './integration-test-harness.js';
export { AWSServiceManager, ECSServiceClient, DynamoDBServiceClient, CloudWatchServiceClient, ALBServiceClient } from './aws-service-clients.js';
export { TestDataManager } from './test-data-manager.js';
export { testUtils } from './setup-tests.js';

// Re-export configuration and types
export * from '../config/test-config.js';

/**
 * Quick start function for running integration tests
 */
export async function runIntegrationTest(
  _testName: string,
  testFn: (harness: any) => Promise<void>
): Promise<{ success: boolean; duration: number; error?: string }> {
  const startTime = Date.now();
  const { IntegrationTestHarness } = await import('./integration-test-harness.js');
  const harness = new IntegrationTestHarness();
  
  try {
    await testFn(harness);
    return {
      success: true,
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  } finally {
    await harness.cleanup();
  }
}

/**
 * Health check for integration test environment
 */
export async function healthCheck(): Promise<{
  healthy: boolean;
  services: Array<{ service: string; healthy: boolean; details?: string }>;
}> {
  const { AWSServiceManager } = await import('./aws-service-clients.js');
  const awsServices = new AWSServiceManager();
  const services = await awsServices.healthCheck();
  
  return {
    healthy: services.every((s: any) => s.healthy),
    services
  };
}

/**
 * Version information
 */
export const version = '1.0.0';

console.log(`Webordinary Integration Test Framework v${version} loaded`);