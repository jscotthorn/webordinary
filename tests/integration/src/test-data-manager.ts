import { v4 as uuidv4 } from 'uuid';
import { TEST_CONFIG, CreateSessionParams, TestSession, TestResults } from '../config/test-config.js';

/**
 * Manages test data generation, cleanup, and lifecycle
 */
export class TestDataManager {
  private readonly activeSessions: Map<string, TestSession> = new Map();
  private readonly testResults: TestResults[] = [];
  private readonly testRunId: string;

  constructor() {
    this.testRunId = `test-run-${Date.now()}-${uuidv4().slice(0, 8)}`;
  }

  /**
   * Generates realistic test session parameters
   */
  generateSessionParams(overrides: Partial<CreateSessionParams> = {}): CreateSessionParams {
    const baseUserId = `user-${Math.random().toString(36).substr(2, 8)}@test.com`;
    
    const defaultParams: CreateSessionParams = {
      clientId: TEST_CONFIG.testData.clientId,
      userId: baseUserId,
      instruction: this.generateTestInstruction(),
      metadata: {
        testRunId: this.testRunId,
        generatedAt: new Date().toISOString(),
        testType: 'integration'
      }
    };

    return { ...defaultParams, ...overrides };
  }

  /**
   * Generates realistic test instructions for various scenarios
   */
  generateTestInstruction(type: 'simple' | 'complex' | 'file-creation' | 'component' = 'simple'): string {
    const instructions = {
      simple: [
        'Add a new page called "About" with basic content',
        'Update the site title to "Test Site"',
        'Add a footer with copyright information',
        'Create a simple contact form',
        'Add navigation links to the header'
      ],
      complex: [
        'Refactor the layout component to use CSS Grid and add responsive breakpoints',
        'Implement a blog system with categories, tags, and pagination',
        'Create an image gallery with lightbox functionality and lazy loading',
        'Add a search feature that works across all pages and content types',
        'Implement user authentication with login/logout and protected routes'
      ],
      'file-creation': [
        'Create a new component called Header.astro with navigation',
        'Add a CSS file for custom styles in the styles directory',
        'Create a utilities/helpers.ts file with common functions',
        'Add a new page under pages/blog/index.astro',
        'Create a JSON data file for site configuration'
      ],
      component: [
        'Build a reusable Card component with props for title and content',
        'Create a responsive navigation component with mobile menu',
        'Add a testimonials carousel component',
        'Build a contact form component with validation',
        'Create a hero section component with background image support'
      ]
    };

    const typeInstructions = instructions[type];
    return typeInstructions[Math.floor(Math.random() * typeInstructions.length)];
  }

  /**
   * Creates test workspace data structure
   */
  createTestWorkspaceStructure(): {
    files: Record<string, string>;
    directories: string[];
  } {
    return {
      files: {
        'package.json': JSON.stringify({
          name: 'test-astro-site',
          version: '1.0.0',
          scripts: {
            'dev': 'astro dev',
            'build': 'astro build',
            'preview': 'astro preview'
          },
          dependencies: {
            'astro': '^3.0.0'
          }
        }, null, 2),
        'astro.config.mjs': `import { defineConfig } from 'astro/config';

export default defineConfig({
  server: {
    port: 4321,
    host: true
  }
});`,
        'src/pages/index.astro': `---
const title = 'Test Site';
---
<html>
  <head>
    <title>{title}</title>
  </head>
  <body>
    <h1>Welcome to {title}</h1>
    <p>This is a test site for integration testing.</p>
  </body>
</html>`,
        'src/layouts/BaseLayout.astro': `---
export interface Props {
  title: string;
}
const { title } = Astro.props;
---
<html>
  <head>
    <title>{title}</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body>
    <slot />
  </body>
</html>`
      },
      directories: [
        'src',
        'src/pages',
        'src/layouts',
        'src/components',
        'public'
      ]
    };
  }

  /**
   * Generates test files for specific scenarios
   */
  generateTestFiles(scenario: 'component' | 'page' | 'style' | 'config'): Record<string, string> {
    switch (scenario) {
      case 'component':
        return {
          'src/components/TestComponent.astro': `---
export interface Props {
  title: string;
  content?: string;
}
const { title, content } = Astro.props;
---
<div class="test-component">
  <h2>{title}</h2>
  {content && <p>{content}</p>}
</div>

<style>
.test-component {
  padding: 1rem;
  border: 1px solid #ccc;
  border-radius: 4px;
}
</style>`
        };

      case 'page':
        return {
          'src/pages/test-page.astro': `---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="Test Page">
  <h1>Test Page</h1>
  <p>This is a dynamically created test page.</p>
</BaseLayout>`
        };

      case 'style':
        return {
          'src/styles/global.css': `/* Global test styles */
body {
  font-family: Arial, sans-serif;
  margin: 0;
  padding: 0;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem;
}`
        };

      case 'config':
        return {
          'test-config.json': JSON.stringify({
            siteName: 'Test Integration Site',
            environment: 'testing',
            features: {
              analytics: false,
              blog: true,
              search: false
            }
          }, null, 2)
        };

      default:
        return {};
    }
  }

  /**
   * Records a test session for tracking
   */
  recordTestSession(session: TestSession): void {
    this.activeSessions.set(session.sessionId, session);
  }

  /**
   * Records test results for reporting
   */
  recordTestResult(result: TestResults): void {
    this.testResults.push(result);
  }

  /**
   * Gets all active test sessions
   */
  getActiveSessions(): TestSession[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Gets test results for reporting
   */
  getTestResults(): TestResults[] {
    return [...this.testResults];
  }

  /**
   * Calculates test run statistics
   */
  calculateTestStatistics(): {
    totalTests: number;
    passed: number;
    failed: number;
    successRate: number;
    totalDuration: number;
    averageDuration: number;
    containerStartupStats?: {
      mean: number;
      min: number;
      max: number;
    };
    sessionCreationStats?: {
      mean: number;
      min: number;
      max: number;
    };
  } {
    const results = this.testResults;
    const total = results.length;
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    const containerStartupTimes = results
      .map(r => r.containerStartupTime)
      .filter((t): t is number => t !== undefined);

    const sessionCreationTimes = results
      .map(r => r.sessionCreationTime)
      .filter((t): t is number => t !== undefined);

    return {
      totalTests: total,
      passed,
      failed,
      successRate: total > 0 ? (passed / total) * 100 : 0,
      totalDuration,
      averageDuration: total > 0 ? totalDuration / total : 0,
      containerStartupStats: containerStartupTimes.length > 0 ? {
        mean: containerStartupTimes.reduce((a, b) => a + b) / containerStartupTimes.length,
        min: Math.min(...containerStartupTimes),
        max: Math.max(...containerStartupTimes)
      } : undefined,
      sessionCreationStats: sessionCreationTimes.length > 0 ? {
        mean: sessionCreationTimes.reduce((a, b) => a + b) / sessionCreationTimes.length,
        min: Math.min(...sessionCreationTimes),
        max: Math.max(...sessionCreationTimes)
      } : undefined
    };
  }

  /**
   * Generates a comprehensive test report
   */
  generateTestReport(): {
    runId: string;
    timestamp: string;
    statistics: ReturnType<TestDataManager['calculateTestStatistics']>;
    results: TestResults[];
    activeSessions: TestSession[];
    errors: string[];
  } {
    const stats = this.calculateTestStatistics();
    const errors = this.testResults
      .filter(r => r.error)
      .map(r => r.error!)
      .filter((error, index, arr) => arr.indexOf(error) === index); // Remove duplicates

    return {
      runId: this.testRunId,
      timestamp: new Date().toISOString(),
      statistics: stats,
      results: this.getTestResults(),
      activeSessions: this.getActiveSessions(),
      errors
    };
  }

  /**
   * Exports test results to JSON file
   */
  async exportTestResults(_filename?: string): Promise<string> {
    const report = this.generateTestReport();

    try {
      // In a real implementation, you'd write to filesystem
      // For now, we'll just return the JSON string
      return JSON.stringify(report, null, 2);
    } catch (error) {
      throw new Error(`Failed to export test results: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validates expected test outcomes
   */
  validateTestOutcome(testName: string, expected: {
    shouldPass: boolean;
    maxDuration?: number;
    maxContainerStartup?: number;
    requiredFiles?: string[];
  }): { passed: boolean; violations: string[] } {
    const result = this.testResults.find(r => r.testName === testName);
    
    if (!result) {
      return {
        passed: false,
        violations: [`Test result not found for: ${testName}`]
      };
    }

    const violations: string[] = [];

    // Check pass/fail expectation
    if (expected.shouldPass && result.status !== 'passed') {
      violations.push(`Expected test to pass but got status: ${result.status}`);
    } else if (!expected.shouldPass && result.status === 'passed') {
      violations.push(`Expected test to fail but it passed`);
    }

    // Check duration limits
    if (expected.maxDuration && result.duration > expected.maxDuration) {
      violations.push(`Test duration ${result.duration}ms exceeded limit ${expected.maxDuration}ms`);
    }

    // Check container startup limits
    if (expected.maxContainerStartup && result.containerStartupTime && 
        result.containerStartupTime > expected.maxContainerStartup) {
      violations.push(`Container startup ${result.containerStartupTime}ms exceeded limit ${expected.maxContainerStartup}ms`);
    }

    // Additional validations can be added here

    return {
      passed: violations.length === 0,
      violations
    };
  }

  /**
   * Cleans up all test data and sessions
   */
  async cleanup(): Promise<void> {
    // Clear in-memory data
    this.activeSessions.clear();
    
    console.log(`Test data cleanup completed for run: ${this.testRunId}`);
  }

  /**
   * Gets the current test run ID
   */
  getTestRunId(): string {
    return this.testRunId;
  }
}