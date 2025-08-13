/**
 * Mock services and utilities for container S3 architecture tests
 * 
 * These mocks reflect the current architecture:
 * - No HTTP servers (removed Express/port 8080)
 * - S3 deployment via aws s3 sync
 * - SQS message processing only
 * - Project+User claiming pattern
 */

const { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');

/**
 * Mock Queue Manager for container tests
 */
class MockQueueManager {
  constructor() {
    this.currentClaim = null;
    this.messageQueue = [];
  }

  async claimWork(projectId, userId) {
    this.currentClaim = { projectId, userId };
    return {
      success: true,
      projectId,
      userId,
      queueUrl: `https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-input-${projectId}-${userId}`,
    };
  }

  getCurrentClaim() {
    return this.currentClaim;
  }

  async releaseWork() {
    this.currentClaim = null;
    return { success: true };
  }

  async sendResponse(message) {
    this.messageQueue.push(message);
    return { MessageId: `mock-${Date.now()}` };
  }

  getMessages() {
    return this.messageQueue;
  }
}

/**
 * Mock S3 Sync Service for deployment tests
 */
class MockS3SyncService {
  constructor() {
    this.deployments = [];
  }

  async syncToS3(localPath, bucketName) {
    const deployment = {
      localPath,
      bucketName,
      timestamp: Date.now(),
      files: ['index.html', 'styles.css', 'script.js'],
    };
    this.deployments.push(deployment);
    
    return {
      success: true,
      filesUploaded: deployment.files.length,
      bucket: bucketName,
    };
  }

  getDeployments() {
    return this.deployments;
  }

  getLastDeployment() {
    return this.deployments[this.deployments.length - 1];
  }
}

/**
 * Mock Git Service for repository operations
 */
class MockGitService {
  constructor() {
    this.currentBranch = 'main';
    this.commits = [];
    this.clonedRepos = [];
  }

  async cloneRepo(repoUrl, targetDir) {
    this.clonedRepos.push({ repoUrl, targetDir });
    return { success: true };
  }

  async checkoutBranch(branchName) {
    this.currentBranch = branchName;
    return { success: true };
  }

  async commit(message, files) {
    const commit = {
      message,
      files,
      branch: this.currentBranch,
      timestamp: Date.now(),
    };
    this.commits.push(commit);
    return { success: true, commitId: `mock-commit-${Date.now()}` };
  }

  async push() {
    return { success: true };
  }

  getCurrentBranch() {
    return this.currentBranch;
  }

  getCommits() {
    return this.commits;
  }
}

/**
 * Mock Claude Code CLI executor
 */
class MockClaudeExecutor {
  constructor() {
    this.executions = [];
  }

  async execute(instruction, context) {
    const execution = {
      instruction,
      context,
      timestamp: Date.now(),
      result: {
        success: true,
        summary: `Executed: ${instruction}`,
        filesChanged: ['src/pages/index.astro'],
      },
    };
    this.executions.push(execution);
    return execution.result;
  }

  getExecutions() {
    return this.executions;
  }
}

/**
 * Mock message formats for container testing
 */
const mockMessages = {
  // Message from unclaimed queue
  unclaimedMessage: {
    type: 'claim_request',
    projectId: 'amelia',
    userId: 'scott',
    sessionId: 'test-session',
    threadId: 'thread-123',
    instruction: 'Update homepage',
    repoUrl: 'https://github.com/webordinary/amelia-site.git',
  },

  // Message from project+user input queue
  projectMessage: {
    sessionId: 'test-session',
    threadId: 'thread-123',
    projectId: 'amelia',
    userId: 'scott',
    instruction: 'Add new feature',
    commandId: 'cmd-456',
    timestamp: Date.now(),
  },

  // Response to send to output queue
  responseMessage: {
    commandId: 'cmd-456',
    sessionId: 'test-session',
    success: true,
    summary: 'Feature added successfully',
    filesChanged: ['src/components/NewFeature.astro'],
    s3Deployed: true,
    bucket: 'edit.amelia.webordinary.com',
  },
};

/**
 * Mock environment variables (no longer using CLIENT_ID, REPO_URL, etc)
 */
const mockEnvVars = {
  // AWS Configuration
  AWS_REGION: 'us-west-2',
  AWS_ACCOUNT_ID: '942734823970',
  
  // Queue URLs (discovered dynamically, not hardcoded)
  UNCLAIMED_QUEUE_URL: 'https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed',
  
  // Table names
  CONTAINER_OWNERSHIP_TABLE: 'webordinary-container-ownership',
  SESSION_TABLE: 'webordinary-edit-sessions',
  
  // EFS paths
  EFS_MOUNT_PATH: '/mnt/efs',
  
  // Container config
  CONTAINER_ID: 'test-container-123',
  
  // Note: No REPO_URL, CLIENT_ID, DEFAULT_USER_ID, PORT
};

/**
 * Helper to simulate message processing flow
 */
async function simulateMessageProcessing(queueManager, s3Sync, git, claude, message) {
  // 1. Claim work if from unclaimed queue
  if (message.type === 'claim_request') {
    await queueManager.claimWork(message.projectId, message.userId);
    
    // Clone repo if provided
    if (message.repoUrl) {
      await git.cloneRepo(message.repoUrl, `/mnt/efs/${message.projectId}-${message.userId}`);
    }
    
    // Checkout session branch
    await git.checkoutBranch(`thread-${message.threadId}`);
  }

  // 2. Execute instruction with Claude
  const result = await claude.execute(message.instruction, {
    projectId: message.projectId,
    userId: message.userId,
    sessionId: message.sessionId,
  });

  // 3. If changes made, build and deploy to S3
  if (result.filesChanged && result.filesChanged.length > 0) {
    // Simulate Astro build
    const buildOutput = `/tmp/dist`;
    
    // Deploy to S3
    const bucketName = `edit.${message.projectId}.webordinary.com`;
    await s3Sync.syncToS3(buildOutput, bucketName);
    
    // Commit changes
    await git.commit(
      `Update via session ${message.sessionId}: ${message.instruction}`,
      result.filesChanged
    );
    await git.push();
  }

  // 4. Send response
  await queueManager.sendResponse({
    ...result,
    commandId: message.commandId,
    sessionId: message.sessionId,
    s3Deployed: true,
    bucket: `edit.${message.projectId}.webordinary.com`,
  });

  return result;
}

/**
 * Helper to create complete mock environment
 */
function createMockEnvironment() {
  return {
    queueManager: new MockQueueManager(),
    s3Sync: new MockS3SyncService(),
    git: new MockGitService(),
    claude: new MockClaudeExecutor(),
    envVars: mockEnvVars,
    messages: mockMessages,
  };
}

/**
 * Assertion helpers
 */
function assertS3Deployment(s3Sync, expectedBucket) {
  const deployment = s3Sync.getLastDeployment();
  expect(deployment).toBeDefined();
  expect(deployment.bucketName).toBe(expectedBucket);
}

function assertGitCommit(git, expectedBranch) {
  const commits = git.getCommits();
  expect(commits.length).toBeGreaterThan(0);
  const lastCommit = commits[commits.length - 1];
  expect(lastCommit.branch).toBe(expectedBranch);
}

function assertQueueResponse(queueManager, expectedSuccess) {
  const messages = queueManager.getMessages();
  expect(messages.length).toBeGreaterThan(0);
  const lastMessage = messages[messages.length - 1];
  expect(lastMessage.success).toBe(expectedSuccess);
}

module.exports = {
  MockQueueManager,
  MockS3SyncService,
  MockGitService,
  MockClaudeExecutor,
  mockMessages,
  mockEnvVars,
  simulateMessageProcessing,
  createMockEnvironment,
  assertS3Deployment,
  assertGitCommit,
  assertQueueResponse,
};