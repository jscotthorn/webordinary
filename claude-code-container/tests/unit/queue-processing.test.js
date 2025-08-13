/**
 * Unit tests for container queue processing
 * Tests the S3 architecture message flow
 */

const {
  createMockEnvironment,
  simulateMessageProcessing,
  assertS3Deployment,
  assertGitCommit,
  assertQueueResponse,
} = require('../mocks/s3-architecture.mocks');

describe('Container Queue Processing (S3 Architecture)', () => {
  let mockEnv;

  beforeEach(() => {
    mockEnv = createMockEnvironment();
  });

  describe('Project+User Claiming', () => {
    it('should claim work from unclaimed queue', async () => {
      const { queueManager, messages } = mockEnv;
      const message = messages.unclaimedMessage;

      const result = await queueManager.claimWork(message.projectId, message.userId);

      expect(result.success).toBe(true);
      expect(result.projectId).toBe('amelia');
      expect(result.userId).toBe('scott');
      
      const claim = queueManager.getCurrentClaim();
      expect(claim).toEqual({
        projectId: 'amelia',
        userId: 'scott',
      });
    });

    it('should handle multiple sessions for same project+user', async () => {
      const { queueManager, claude, messages } = mockEnv;
      
      // Claim work
      await queueManager.claimWork('amelia', 'scott');
      
      // Process multiple messages for different sessions
      const session1 = { ...messages.projectMessage, sessionId: 'session-1', threadId: 'thread-1' };
      const session2 = { ...messages.projectMessage, sessionId: 'session-2', threadId: 'thread-2' };
      
      await claude.execute(session1.instruction, { sessionId: session1.sessionId });
      await claude.execute(session2.instruction, { sessionId: session2.sessionId });
      
      const executions = claude.getExecutions();
      expect(executions).toHaveLength(2);
      expect(executions[0].context.sessionId).toBe('session-1');
      expect(executions[1].context.sessionId).toBe('session-2');
      
      // Should maintain single claim
      const claim = queueManager.getCurrentClaim();
      expect(claim.projectId).toBe('amelia');
      expect(claim.userId).toBe('scott');
    });
  });

  describe('S3 Deployment Flow', () => {
    it('should deploy to S3 after processing', async () => {
      const { s3Sync, messages } = mockEnv;
      const message = messages.unclaimedMessage;

      await simulateMessageProcessing(
        mockEnv.queueManager,
        mockEnv.s3Sync,
        mockEnv.git,
        mockEnv.claude,
        message
      );

      assertS3Deployment(s3Sync, 'edit.amelia.webordinary.com');
      
      const deployments = s3Sync.getDeployments();
      expect(deployments).toHaveLength(1);
      expect(deployments[0].files).toContain('index.html');
    });

    it('should use correct S3 bucket per project', async () => {
      const { s3Sync } = mockEnv;
      
      // Test different projects
      await s3Sync.syncToS3('/tmp/dist', 'edit.amelia.webordinary.com');
      await s3Sync.syncToS3('/tmp/dist', 'edit.test.webordinary.com');
      
      const deployments = s3Sync.getDeployments();
      expect(deployments).toHaveLength(2);
      expect(deployments[0].bucketName).toBe('edit.amelia.webordinary.com');
      expect(deployments[1].bucketName).toBe('edit.test.webordinary.com');
    });
  });

  describe('Git Operations', () => {
    it('should checkout thread-specific branch', async () => {
      const { git, messages } = mockEnv;
      const message = messages.unclaimedMessage;

      await simulateMessageProcessing(
        mockEnv.queueManager,
        mockEnv.s3Sync,
        mockEnv.git,
        mockEnv.claude,
        message
      );

      expect(git.getCurrentBranch()).toBe('thread-thread-123');
      assertGitCommit(git, 'thread-thread-123');
    });

    it('should clone repo on first claim', async () => {
      const { git, messages } = mockEnv;
      const message = messages.unclaimedMessage;

      await simulateMessageProcessing(
        mockEnv.queueManager,
        mockEnv.s3Sync,
        mockEnv.git,
        mockEnv.claude,
        message
      );

      const clonedRepos = git.clonedRepos;
      expect(clonedRepos).toHaveLength(1);
      expect(clonedRepos[0].repoUrl).toBe('https://github.com/webordinary/amelia-site.git');
      expect(clonedRepos[0].targetDir).toContain('amelia-scott');
    });
  });

  describe('Message Response', () => {
    it('should send success response to output queue', async () => {
      const { queueManager, messages } = mockEnv;
      const message = messages.projectMessage;

      await simulateMessageProcessing(
        mockEnv.queueManager,
        mockEnv.s3Sync,
        mockEnv.git,
        mockEnv.claude,
        message
      );

      assertQueueResponse(queueManager, true);
      
      const responses = queueManager.getMessages();
      expect(responses[0]).toMatchObject({
        commandId: message.commandId,
        sessionId: message.sessionId,
        success: true,
        s3Deployed: true,
        bucket: 'edit.amelia.webordinary.com',
      });
    });

    it('should include changed files in response', async () => {
      const { queueManager, claude, messages } = mockEnv;
      const message = messages.projectMessage;

      await simulateMessageProcessing(
        mockEnv.queueManager,
        mockEnv.s3Sync,
        mockEnv.git,
        mockEnv.claude,
        message
      );

      const responses = queueManager.getMessages();
      expect(responses[0].filesChanged).toBeDefined();
      expect(responses[0].filesChanged).toContain('src/pages/index.astro');
    });
  });

  describe('Error Handling', () => {
    it('should handle S3 sync failures gracefully', async () => {
      const { s3Sync, queueManager, messages } = mockEnv;
      
      // Mock S3 sync failure
      s3Sync.syncToS3 = jest.fn().mockRejectedValue(new Error('S3 permission denied'));
      
      try {
        await simulateMessageProcessing(
          mockEnv.queueManager,
          s3Sync,
          mockEnv.git,
          mockEnv.claude,
          messages.projectMessage
        );
      } catch (error) {
        expect(error.message).toContain('S3 permission denied');
      }
      
      // Should still maintain claim
      const claim = queueManager.getCurrentClaim();
      expect(claim).toBeDefined();
    });

    it('should handle git failures gracefully', async () => {
      const { git, messages } = mockEnv;
      
      // Mock git push failure
      git.push = jest.fn().mockRejectedValue(new Error('Authentication failed'));
      
      try {
        await simulateMessageProcessing(
          mockEnv.queueManager,
          mockEnv.s3Sync,
          git,
          mockEnv.claude,
          messages.unclaimedMessage
        );
      } catch (error) {
        expect(error.message).toContain('Authentication failed');
      }
      
      // Should have committed locally
      const commits = git.getCommits();
      expect(commits.length).toBeGreaterThan(0);
    });
  });

  describe('Environment Configuration', () => {
    it('should not use legacy environment variables', () => {
      const { envVars } = mockEnv;
      
      // Should NOT have these legacy variables
      expect(envVars.CLIENT_ID).toBeUndefined();
      expect(envVars.REPO_URL).toBeUndefined();
      expect(envVars.DEFAULT_USER_ID).toBeUndefined();
      expect(envVars.DEFAULT_USER_EMAIL).toBeUndefined();
      expect(envVars.PORT).toBeUndefined();
      
      // Should have new architecture variables
      expect(envVars.UNCLAIMED_QUEUE_URL).toBeDefined();
      expect(envVars.CONTAINER_OWNERSHIP_TABLE).toBeDefined();
      expect(envVars.EFS_MOUNT_PATH).toBeDefined();
    });

    it('should use queue URLs dynamically', () => {
      const { queueManager } = mockEnv;
      
      // Queue URLs should be generated based on project+user
      const claim = queueManager.claimWork('test', 'user');
      expect(claim.queueUrl).toContain('webordinary-input-test-user');
      
      // Not hardcoded
      const claim2 = queueManager.claimWork('demo', 'admin');
      expect(claim2.queueUrl).toContain('webordinary-input-demo-admin');
    });
  });
});

describe('Container Health (No HTTP)', () => {
  it('should not have HTTP health endpoints', () => {
    // No Express app
    expect(global.app).toBeUndefined();
    
    // No port listening
    expect(process.env.PORT).toBeUndefined();
  });

  it('should use CloudWatch for health monitoring', () => {
    // Health is determined by CloudWatch metrics/logs
    // Not by HTTP health checks
    const mockEnv = createMockEnvironment();
    
    // Container should report via logs
    expect(mockEnv.envVars.AWS_REGION).toBeDefined();
    expect(mockEnv.envVars.CONTAINER_ID).toBeDefined();
  });
});