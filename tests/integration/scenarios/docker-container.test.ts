import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

describe('Docker Container E2E Tests', () => {
  const projectRoot = path.resolve(__dirname, '../../../');
  const containerRoot = path.join(projectRoot, 'claude-code-container');
  const workspaceDir = path.join(containerRoot, 'workspace');
  const scriptPath = path.join(containerRoot, 'scripts', 'run-e2e-docker.sh');
  
  // Test configuration
  const testTimeout = 5 * 60 * 1000; // 5 minutes
  
  beforeAll(async () => {
    // Ensure required environment variables are set
    if (!process.env.GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN environment variable is required');
    }
    
    if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) {
      throw new Error('AWS_PROFILE or AWS credentials are required');
    }
    
    // Clean up workspace
    await execAsync(`rm -rf ${workspaceDir} && mkdir -p ${workspaceDir}`);
    
    // Build the Docker image
    console.log('Building Docker image...');
    const { stdout, stderr } = await execAsync(
      `cd ${containerRoot} && npm run build`,
      { env: process.env }
    );
    
    if (stderr && !stderr.includes('warning')) {
      console.error('Build stderr:', stderr);
    }
  }, testTimeout);
  
  afterAll(async () => {
    // Clean up Docker containers
    try {
      await execAsync(
        `cd ${containerRoot} && docker-compose -f docker-compose.test.yml down --volumes --remove-orphans`
      );
    } catch (error) {
      console.warn('Cleanup warning:', error);
    }
  });
  
  describe('Basic Container Functionality', () => {
    it('should build and start the container successfully', async () => {
      const { stdout, stderr } = await execAsync(
        `${scriptPath} build`,
        { 
          env: {
            ...process.env,
            PATH: process.env.PATH
          }
        }
      );
      
      expect(stderr).not.toContain('ERROR');
      expect(stdout).toContain('Docker image built successfully');
    }, testTimeout);
    
    it('should process a basic test message', async () => {
      // Create a simple test message
      const testMessage = {
        projectId: 'amelia',
        userId: 'test-user',
        chatThreadId: `test-${Date.now()}`,
        message: 'Create a simple index.html file with Hello World',
        timestamp: new Date().toISOString()
      };
      
      // Write test message to workspace
      await fs.writeFile(
        path.join(workspaceDir, 'test-message.json'),
        JSON.stringify(testMessage, null, 2)
      );
      
      // Run container with test message
      const { stdout, stderr } = await execAsync(
        `${scriptPath} test basic`,
        {
          env: {
            ...process.env,
            UNCLAIMED_QUEUE_URL: 'https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed',
            INPUT_QUEUE_URL: 'https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-input',
            OUTPUT_QUEUE_URL: 'https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-output',
            INTERRUPT_QUEUE_URL: 'https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-interrupt'
          },
          timeout: testTimeout
        }
      );
      
      // Check for successful processing
      expect(stderr).not.toContain('ERROR');
      expect(stdout).toContain('Test completed');
    }, testTimeout);
  });
  
  describe('S3 Deployment', () => {
    it('should deploy to S3 successfully', async () => {
      const testMessage = {
        projectId: 'amelia',
        userId: 'test-user',
        chatThreadId: `test-s3-${Date.now()}`,
        message: 'Create an Astro site with a homepage',
        timestamp: new Date().toISOString(),
        deployToS3: true
      };
      
      // Write test message
      await fs.writeFile(
        path.join(workspaceDir, 'test-message.json'),
        JSON.stringify(testMessage, null, 2)
      );
      
      // Run S3 deployment test
      const { stdout, stderr } = await execAsync(
        `${scriptPath} test s3`,
        {
          env: process.env,
          timeout: testTimeout
        }
      );
      
      expect(stderr).not.toContain('ERROR');
      expect(stdout).toContain('Test completed');
      
      // Verify S3 deployment
      const checkS3 = await execAsync(
        `AWS_PROFILE=personal aws s3 ls s3://edit.amelia.webordinary.com/ --summarize`,
        { env: process.env }
      );
      
      expect(checkS3.stdout).toBeDefined();
    }, testTimeout);
  });
  
  describe('Step Functions Integration', () => {
    it('should handle Step Functions callback', async () => {
      const taskToken = 'test-token-' + Date.now();
      const testMessage = {
        projectId: 'amelia',
        userId: 'test-user',
        chatThreadId: `test-sf-${Date.now()}`,
        message: 'Process with Step Functions',
        timestamp: new Date().toISOString(),
        taskToken: taskToken,
        messageId: `msg-${Date.now()}`
      };
      
      // Write test message
      await fs.writeFile(
        path.join(workspaceDir, 'test-message.json'),
        JSON.stringify(testMessage, null, 2)
      );
      
      // Run Step Functions test
      const { stdout, stderr } = await execAsync(
        `${scriptPath} test stepfunction`,
        {
          env: {
            ...process.env,
            TASK_TOKEN: taskToken
          },
          timeout: testTimeout
        }
      );
      
      expect(stderr).not.toContain('ERROR');
      expect(stdout).toContain('Test completed');
    }, testTimeout);
  });
  
  describe('Error Handling', () => {
    it('should handle missing environment variables gracefully', async () => {
      try {
        await execAsync(
          `${scriptPath} test basic`,
          {
            env: {
              PATH: process.env.PATH,
              // Intentionally omit GITHUB_TOKEN
            }
          }
        );
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.stderr || error.stdout).toContain('Missing required environment variables');
      }
    });
    
    it('should timeout long-running processes', async () => {
      // Create a message that would cause a long-running process
      const testMessage = {
        projectId: 'amelia',
        userId: 'test-user',
        chatThreadId: `test-timeout-${Date.now()}`,
        message: 'Run an infinite loop: while true; do sleep 1; done',
        timestamp: new Date().toISOString()
      };
      
      await fs.writeFile(
        path.join(workspaceDir, 'test-message.json'),
        JSON.stringify(testMessage, null, 2)
      );
      
      try {
        await execAsync(
          `timeout 10 ${scriptPath} test basic`,
          {
            env: process.env,
            timeout: 15000 // 15 seconds
          }
        );
        fail('Should have timed out');
      } catch (error: any) {
        // Timeout exit code is 124
        expect(error.code).toBe(124);
      }
    });
  });
  
  describe('Container Logs', () => {
    it('should retrieve container logs', async () => {
      const { stdout } = await execAsync(
        `${scriptPath} logs`,
        { env: process.env }
      );
      
      expect(stdout).toBeDefined();
    });
  });
});