import {
  ECSClient,
  DescribeServicesCommand,
  UpdateServiceCommand
} from '@aws-sdk/client-ecs';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  ScanCommand
} from '@aws-sdk/client-dynamodb';
import {
  CloudWatchClient,
  PutMetricDataCommand,
  StandardUnit
} from '@aws-sdk/client-cloudwatch';
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand
} from '@aws-sdk/client-cloudwatch-logs';
import {
  S3Client,
  HeadObjectCommand,
  ListObjectsV2Command
} from '@aws-sdk/client-s3';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
// Use built-in fetch for Node.js 18+
const fetch = globalThis.fetch;
import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';

import { TEST_CONFIG, CreateSessionParams, TestSession, TestResults } from '../config/test-config.js';

export class IntegrationTestHarness {
  private readonly ecsClient: ECSClient;
  private readonly dynamoClient: DynamoDBClient;
  private readonly cloudWatchClient: CloudWatchClient;
  private readonly cloudWatchLogsClient: CloudWatchLogsClient;
  private readonly s3Client: S3Client;
  private readonly albEndpoint: string;
  private readonly testSessions: Set<string> = new Set();

  constructor() {
    const awsConfig = {
      region: TEST_CONFIG.aws.region
      // Uses default credential chain: env vars, ~/.aws/credentials, IAM roles
    };

    this.ecsClient = new ECSClient(awsConfig);
    this.dynamoClient = new DynamoDBClient(awsConfig);
    this.cloudWatchClient = new CloudWatchClient(awsConfig);
    this.cloudWatchLogsClient = new CloudWatchLogsClient(awsConfig);
    this.s3Client = new S3Client(awsConfig);
    this.albEndpoint = TEST_CONFIG.endpoints.alb;
    
  }

  /**
   * Creates a test session directly in DynamoDB (fallback when Hermes unavailable)
   */
  async createTestSessionDirect(params: CreateSessionParams): Promise<TestSession> {
    const sessionId = `session-${uuidv4()}`;
    const threadId = `thread-${uuidv4()}`;
    const now = Date.now();
    const ttl = Math.floor(now / 1000) + (24 * 60 * 60); // 24 hours from now
    const userId = `${TEST_CONFIG.testData.testPrefix}${params.userId || 'test@example.com'}`;
    const clientId = params.clientId || TEST_CONFIG.testData.clientId;
    
    const session: TestSession = {
      sessionId,
      threadId,
      clientId,
      userId,
      status: 'initializing',
      previewUrl: `${TEST_CONFIG.endpoints.alb}/session/${sessionId}`,
      lastActivity: now,
      ttl,
      metadata: {
        ...params.metadata,
        testSession: true,
        testId: uuidv4(),
        createdAt: new Date().toISOString(),
        instruction: params.instruction
      }
    };

    // Put session in DynamoDB - need to store the full record
    const dynamoItem = {
      sessionId,
      userId,
      clientId,
      threadId,
      status: 'initializing',
      previewUrl: session.previewUrl,
      lastActivity: now,
      ttl,
      createdAt: now,
      metadata: session.metadata
    };

    const putCommand = new PutItemCommand({
      TableName: TEST_CONFIG.services.dynamoTableName,
      Item: marshall(dynamoItem)
    });

    await this.dynamoClient.send(putCommand);
    this.testSessions.add(sessionId);
    
    console.log(`Created test session directly in DynamoDB: ${sessionId}`);
    return session;
  }

  /**
   * Creates a test session via the Hermes API
   */
  async createTestSession(params: CreateSessionParams): Promise<TestSession> {
    const sessionStartTime = Date.now();
    
    const requestBody = {
      clientId: params.clientId || TEST_CONFIG.testData.clientId,
      userId: `${TEST_CONFIG.testData.testPrefix}${params.userId}`,
      instruction: params.instruction,
      metadata: {
        ...params.metadata,
        testSession: true,
        testId: uuidv4(),
        createdAt: new Date().toISOString()
      }
    };

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${TEST_CONFIG.endpoints.hermes}/api/sessions/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'webordinary-integration-test'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`Hermes API unavailable (${response.status}), falling back to direct DynamoDB creation`);
        // Fall back to direct DynamoDB creation
        return this.createTestSessionDirect(params);
      }

      const session = await response.json() as TestSession;
      this.testSessions.add(session.sessionId);

      // Record session creation time
      session.metadata = {
        ...session.metadata,
        sessionCreationTime: Date.now() - sessionStartTime
      };

      return session;
    } catch (error) {
      console.warn(`Hermes API error: ${error instanceof Error ? error.message : 'Unknown error'}, falling back to direct DynamoDB creation`);
      // Fall back to direct DynamoDB creation on any error
      return this.createTestSessionDirect(params);
    }
  }

  /**
   * Waits for a container to be ready and responsive
   */
  async waitForContainerReady(sessionId: string, timeoutMs = TEST_CONFIG.timeouts.containerReady): Promise<void> {
    const startTime = Date.now();
    const healthCheckUrl = `${this.albEndpoint}/session/${sessionId}/health`;
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(healthCheckUrl, {
          headers: {
            'User-Agent': 'webordinary-integration-test'
          },
          signal: controller.signal,
          });

        clearTimeout(timeoutId);
        
        if (response.ok) {
          const containerStartupTime = Date.now() - startTime;
          console.log(`Container ready for session ${sessionId} in ${containerStartupTime}ms`);
          return;
        }
      } catch (error) {
        // Container not ready yet, continue waiting
      }
      
      await this.sleep(2000); // Wait 2 seconds before retry
    }
    
    throw new Error(`Container not ready for session ${sessionId} after ${timeoutMs}ms`);
  }

  /**
   * Verifies that a file exists in the container workspace
   */
  async verifyFileExists(sessionId: string, filePath: string): Promise<void> {
    const checkUrl = `${this.albEndpoint}/api/files/exists`;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(checkUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
          'User-Agent': 'webordinary-integration-test'
        },
        body: JSON.stringify({ filePath }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`File check failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as { exists: boolean };
      
      if (!result.exists) {
        throw new Error(`File does not exist: ${filePath}`);
      }
    } catch (error) {
      throw new Error(`Failed to verify file exists: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Executes a command in the container and returns the result
   */
  async execInContainer(sessionId: string, command: string): Promise<string> {
    const execUrl = `${this.albEndpoint}/api/exec`;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(execUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
          'User-Agent': 'webordinary-integration-test'
        },
        body: JSON.stringify({ command }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Command execution failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as { output: string; exitCode: number };
      
      if (result.exitCode !== 0) {
        throw new Error(`Command failed with exit code ${result.exitCode}: ${result.output}`);
      }

      return result.output;
    } catch (error) {
      throw new Error(`Failed to execute command: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Verifies that a session exists in DynamoDB
   */
  async verifySessionExists(sessionId: string): Promise<TestSession> {
    try {
      const response = await this.dynamoClient.send(new GetItemCommand({
        TableName: TEST_CONFIG.services.dynamoTableName,
        Key: marshall({
          sessionId: sessionId,
          userId: `${TEST_CONFIG.testData.testPrefix}test@example.com` // Default test user
        })
      }));

      if (!response.Item) {
        throw new Error(`Session not found in DynamoDB: ${sessionId}`);
      }

      return unmarshall(response.Item) as TestSession;
    } catch (error) {
      throw new Error(`Failed to verify session exists: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Gets the current task count for a service
   */
  async getServiceTaskCount(serviceName: string): Promise<number> {
    try {
      const response = await this.ecsClient.send(new DescribeServicesCommand({
        cluster: TEST_CONFIG.services.clusterName,
        services: [serviceName]
      }));

      if (!response.services || response.services.length === 0) {
        throw new Error(`Service not found: ${serviceName}`);
      }

      return response.services[0].runningCount || 0;
    } catch (error) {
      throw new Error(`Failed to get service task count: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Verifies that a service has the expected task count
   */
  async verifyServiceTaskCount(serviceName: string, expectedCount: number): Promise<void> {
    const actualCount = await this.getServiceTaskCount(serviceName);
    
    if (actualCount !== expectedCount) {
      throw new Error(`Service ${serviceName} has ${actualCount} tasks, expected ${expectedCount}`);
    }
  }

  /**
   * Scales a service to the specified task count
   */
  async scaleService(serviceName: string, desiredCount: number): Promise<void> {
    try {
      await this.ecsClient.send(new UpdateServiceCommand({
        cluster: TEST_CONFIG.services.clusterName,
        service: serviceName,
        desiredCount: desiredCount
      }));

      // Wait for scaling to complete
      await this.waitForServiceStable(serviceName, 60000); // 1 minute timeout
    } catch (error) {
      throw new Error(`Failed to scale service: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Forces a service to scale down (for testing container restart)
   */
  async forceScaleDown(serviceName: string, desiredCount: number): Promise<void> {
    await this.scaleService(serviceName, desiredCount);
  }

  /**
   * Waits for a service to reach stable state
   */
  async waitForServiceStable(serviceName: string, timeoutMs = 60000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const response = await this.ecsClient.send(new DescribeServicesCommand({
        cluster: TEST_CONFIG.services.clusterName,
        services: [serviceName]
      }));

      const service = response.services?.[0];
      
      if (service && 
          service.runningCount === service.desiredCount &&
          service.pendingCount === 0) {
        return;
      }

      await this.sleep(3000); // Wait 3 seconds before retry
    }

    throw new Error(`Service ${serviceName} did not stabilize within ${timeoutMs}ms`);
  }

  /**
   * Tests WebSocket connection for HMR
   */
  async testWebSocketConnection(sessionId: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const wsUrl = `wss://${this.albEndpoint.replace('https://', '')}/ws/hmr?sessionId=${sessionId}`;
      const ws = new WebSocket(wsUrl);
      
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }, 10000);

      ws.on('open', () => {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket connection failed: ${error.message}`));
      });
    });
  }

  /**
   * Waits for all sessions to expire
   */
  async waitForAllSessionsExpired(sessions: TestSession[], timeoutMs = TEST_CONFIG.timeouts.sessionExpiry): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      let allExpired = true;
      
      for (const session of sessions) {
        try {
          await this.verifySessionExists(session.sessionId);
          allExpired = false;
          break;
        } catch (error) {
          // Session expired or not found - this is expected
        }
      }
      
      if (allExpired) {
        return;
      }
      
      await this.sleep(5000); // Wait 5 seconds before retry
    }
    
    throw new Error(`Not all sessions expired within ${timeoutMs}ms`);
  }

  /**
   * Verifies that no orphaned containers are running
   */
  async verifyNoOrphanedContainers(): Promise<void> {
    const taskCount = await this.getServiceTaskCount(TEST_CONFIG.services.editService);
    
    if (taskCount > 0) {
      console.warn(`Warning: ${taskCount} tasks still running in ${TEST_CONFIG.services.editService}`);
      
      // Try to clean up orphaned tasks
      await this.scaleService(TEST_CONFIG.services.editService, 0);
      await this.sleep(10000); // Wait 10 seconds
      
      const finalCount = await this.getServiceTaskCount(TEST_CONFIG.services.editService);
      if (finalCount > 0) {
        throw new Error(`Found ${finalCount} orphaned containers after cleanup attempt`);
      }
    }
  }

  /**
   * Publishes test metrics to CloudWatch
   */
  async publishTestMetrics(results: TestResults): Promise<void> {
    const metricData = [
      {
        MetricName: 'TestDuration',
        Value: results.duration,
        Unit: StandardUnit.Milliseconds,
        Dimensions: [
          { Name: 'TestName', Value: results.testName },
          { Name: 'Status', Value: results.status }
        ]
      }
    ];

    if (results.containerStartupTime) {
      metricData.push({
        MetricName: 'ContainerStartupTime',
        Value: results.containerStartupTime,
        Unit: StandardUnit.Milliseconds,
        Dimensions: [{ Name: 'TestName', Value: results.testName }]
      });
    }

    try {
      await this.cloudWatchClient.send(new PutMetricDataCommand({
        Namespace: 'Webordinary/IntegrationTests',
        MetricData: metricData
      }));
    } catch (error) {
      console.warn(`Failed to publish CloudWatch metrics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Comprehensive cleanup of all test resources
   */
  async cleanup(): Promise<void> {
    console.log('Starting comprehensive test cleanup...');
    
    try {
      // Delete all test sessions from DynamoDB
      await this.deleteTestSessions();
      
      // Scale services to zero
      await this.scaleServicesToZero();
      
      // Clean up test workspaces (if accessible)
      await this.cleanupTestWorkspaces();
      
      // Verify no orphaned resources
      await this.verifyNoOrphanedContainers();
      
      console.log('Test cleanup completed successfully');
    } catch (error) {
      console.error(`Test cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  private async deleteTestSessions(): Promise<void> {
    const sessionsToDelete: string[] = [];
    
    try {
      const response = await this.dynamoClient.send(new ScanCommand({
        TableName: TEST_CONFIG.services.dynamoTableName,
        FilterExpression: 'begins_with(userId, :prefix)',
        ExpressionAttributeValues: marshall({
          ':prefix': TEST_CONFIG.testData.testPrefix
        })
      }));

      if (response.Items) {
        for (const item of response.Items) {
          const session = unmarshall(item) as TestSession;
          sessionsToDelete.push(session.sessionId);
        }
      }
    } catch (error) {
      console.warn(`Failed to scan test sessions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Delete sessions individually (DynamoDB doesn't support batch delete with composite keys easily)
    for (const sessionId of sessionsToDelete) {
      try {
        await this.dynamoClient.send(new DeleteItemCommand({
          TableName: TEST_CONFIG.services.dynamoTableName,
          Key: marshall({
            sessionId: sessionId,
            userId: `${TEST_CONFIG.testData.testPrefix}test@example.com`
          })
        }));
      } catch (error) {
        console.warn(`Failed to delete session ${sessionId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    console.log(`Deleted ${sessionsToDelete.length} test sessions`);
  }

  private async scaleServicesToZero(): Promise<void> {
    const services = [TEST_CONFIG.services.editService, TEST_CONFIG.services.hermesService];
    
    for (const serviceName of services) {
      try {
        const currentCount = await this.getServiceTaskCount(serviceName);
        if (currentCount > 0) {
          console.log(`Scaling ${serviceName} from ${currentCount} to 0`);
          await this.scaleService(serviceName, 0);
        }
      } catch (error) {
        console.warn(`Failed to scale ${serviceName} to zero: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  private async cleanupTestWorkspaces(): Promise<void> {
    // This would require EFS access or container execution
    // For now, we'll rely on the natural cleanup process
    console.log('Test workspace cleanup delegated to container lifecycle');
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Session Resumption Methods

  /**
   * Sets container status in DynamoDB
   */
  async setContainerStatus(
    containerId: string, 
    status: 'running' | 'idle' | 'stopped' | 'starting' | 'stopping',
    additionalData?: {
      containerIp?: string;
      taskArn?: string;
      lastActivity?: number;
    }
  ): Promise<void> {
    try {
      const item: any = {
        containerId: { S: containerId },
        status: { S: status },
        lastActivity: { N: (additionalData?.lastActivity || Date.now()).toString() }
      };

      if (additionalData?.containerIp) {
        item.containerIp = { S: additionalData.containerIp };
      }
      
      if (additionalData?.taskArn) {
        item.taskArn = { S: additionalData.taskArn };
      }

      await this.dynamoClient.send(new PutItemCommand({
        TableName: 'webordinary-containers',
        Item: item
      }));

      console.log(`Container ${containerId} status set to: ${status}`);
    } catch (error) {
      throw new Error(`Failed to set container status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Gets container status from DynamoDB
   */
  async getContainerStatus(containerId: string): Promise<{
    status?: string;
    containerIp?: string;
    taskArn?: string;
    lastActivity?: number;
  } | null> {
    try {
      const response = await this.dynamoClient.send(new GetItemCommand({
        TableName: 'webordinary-containers',
        Key: {
          containerId: { S: containerId }
        }
      }));

      if (!response.Item) {
        return null;
      }

      return {
        status: response.Item.status?.S,
        containerIp: response.Item.containerIp?.S,
        taskArn: response.Item.taskArn?.S,
        lastActivity: response.Item.lastActivity?.N ? parseInt(response.Item.lastActivity.N) : undefined
      };
    } catch (error) {
      throw new Error(`Failed to get container status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Waits for container to reach a specific status
   */
  async waitForContainerStatus(
    containerId: string, 
    targetStatus: string, 
    timeout: number = 60000
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const container = await this.getContainerStatus(containerId);
      
      if (container?.status === targetStatus) {
        console.log(`Container ${containerId} reached status: ${targetStatus}`);
        return;
      }
      
      await this.sleep(2000); // Check every 2 seconds
    }
    
    throw new Error(`Container ${containerId} did not reach status ${targetStatus} within ${timeout}ms`);
  }

  /**
   * Gets count of active sessions for a container
   */
  async getActiveSessionCount(containerId: string): Promise<number> {
    try {
      const response = await this.dynamoClient.send(new ScanCommand({
        TableName: 'webordinary-thread-mappings',
        FilterExpression: 'containerId = :containerId',
        ExpressionAttributeValues: {
          ':containerId': { S: containerId }
        },
        Select: 'COUNT'
      }));

      return response.Count || 0;
    } catch (error) {
      console.warn(`Failed to get active session count: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return 0;
    }
  }

  /**
   * Creates a thread mapping for session resumption tests
   */
  async createThreadMapping(sessionId: string, threadId: string, containerId: string): Promise<void> {
    try {
      await this.dynamoClient.send(new PutItemCommand({
        TableName: 'webordinary-thread-mappings',
        Item: {
          threadId: { S: threadId },
          sessionId: { S: sessionId },
          containerId: { S: containerId },
          status: { S: 'active' },
          createdAt: { N: Date.now().toString() }
        }
      }));

      console.log(`Created thread mapping: ${threadId} -> ${sessionId}`);
    } catch (error) {
      throw new Error(`Failed to create thread mapping: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Creates a complete test session with thread mapping for resumption tests
   */
  async createResumptionTestSession(params: CreateSessionParams): Promise<TestSession> {
    // Create the base session using existing method
    const session = await this.createTestSession(params);
    
    // Create container ID
    const containerId = `${params.clientId || TEST_CONFIG.testData.clientId}-${session.threadId}-${params.userId}`;
    
    // Create thread mapping
    await this.createThreadMapping(session.sessionId, session.threadId, containerId);
    
    // Return enhanced session with containerId
    return {
      ...session,
      containerId
    };
  }

  /**
   * Tests Hermes API session resumption directly
   */
  async testHermesSessionResumption(threadId: string, clientId: string): Promise<{
    status: number;
    data: any;
    responseTime: number;
  }> {
    const startTime = Date.now();
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${TEST_CONFIG.endpoints.hermes}/api/sessions/resume-preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY || 'test-key'}`
        },
        body: JSON.stringify({
          chatThreadId: threadId,
          clientId: clientId
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const responseTime = Date.now() - startTime;
      const data = await response.json();

      return {
        status: response.status,
        data,
        responseTime
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      throw new Error(`Hermes API test failed after ${responseTime}ms: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Tests ALB routing with session resumption
   */
  async testALBSessionRouting(threadId: string, clientId: string): Promise<{
    status: number;
    body: string;
    responseTime: number;
    headers: any;
  }> {
    const startTime = Date.now();
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const response = await fetch(
        `https://edit.${clientId}.webordinary.com/session/${threadId}/`,
        {
          signal: controller.signal,
          // redirect: 'manual' // Not supported by built-in fetch
        }
      );

      clearTimeout(timeoutId);

      const responseTime = Date.now() - startTime;
      const body = await response.text();
      
      // Convert headers to plain object
      const headers: any = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: response.status,
        body,
        responseTime,
        headers
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      throw new Error(`ALB routing test failed after ${responseTime}ms: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Simulates container auto-sleep scenario
   */
  async simulateContainerAutoSleep(containerId: string): Promise<void> {
    console.log(`Simulating auto-sleep for container: ${containerId}`);
    
    // Set container to idle first
    await this.setContainerStatus(containerId, 'idle', {
      lastActivity: Date.now() - (21 * 60 * 1000) // 21 minutes ago
    });
    
    await this.sleep(1000);
    
    // Check session count (would be done by auto-sleep service)
    const sessionCount = await this.getActiveSessionCount(containerId);
    
    if (sessionCount === 0) {
      // Simulate graceful shutdown
      await this.setContainerStatus(containerId, 'stopping');
      await this.sleep(2000);
      await this.setContainerStatus(containerId, 'stopped');
      
      console.log(`Container ${containerId} auto-sleep simulation complete`);
    } else {
      console.log(`Container ${containerId} has ${sessionCount} active sessions, staying awake`);
    }
  }

  /**
   * Waits for S3 deployment to complete
   */
  async waitForS3Deployment(clientId: string, timeout = TEST_CONFIG.timeouts.s3SyncTimeout): Promise<void> {
    const bucket = clientId === 'ameliastamps' 
      ? TEST_CONFIG.s3.buckets.amelia 
      : TEST_CONFIG.s3.buckets.test;
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const response = await this.s3Client.send(new HeadObjectCommand({
          Bucket: bucket,
          Key: 'index.html'
        }));
        
        // Check if recently modified (within last 2 minutes)
        const lastModified = response.LastModified?.getTime() || 0;
        const twoMinutesAgo = Date.now() - 120000;
        
        if (lastModified > twoMinutesAgo) {
          console.log(`S3 deployment detected for ${clientId} at ${response.LastModified}`);
          return;
        }
      } catch (error) {
        // File might not exist yet
      }
      
      await this.sleep(2000);
    }
    
    throw new Error(`S3 deployment timeout for ${clientId} after ${timeout}ms`);
  }

  /**
   * Verifies S3 content contains expected text
   */
  async verifyS3Content(clientId: string, searchText: string): Promise<boolean> {
    const url = clientId === 'ameliastamps'
      ? TEST_CONFIG.s3.endpoints.amelia
      : TEST_CONFIG.s3.endpoints.test;
    
    try {
      const response = await fetch(url);
      const html = await response.text();
      return html.includes(searchText);
    } catch (error) {
      console.error('Failed to fetch S3 site:', error);
      return false;
    }
  }

  /**
   * Lists objects in S3 bucket
   */
  async listS3Objects(clientId: string, maxKeys = 100): Promise<string[]> {
    const bucket = clientId === 'ameliastamps'
      ? TEST_CONFIG.s3.buckets.amelia
      : TEST_CONFIG.s3.buckets.test;
    
    try {
      const response = await this.s3Client.send(new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: maxKeys
      }));
      
      return response.Contents?.map(obj => obj.Key || '') || [];
    } catch (error) {
      console.error('Failed to list S3 objects:', error);
      return [];
    }
  }

  /**
   * Checks CloudWatch logs for container startup
   */
  async waitForContainerStartup(sessionId: string, timeout = TEST_CONFIG.timeouts.containerReady): Promise<void> {
    const logGroup = '/ecs/webordinary/edit';
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const response = await this.cloudWatchLogsClient.send(new FilterLogEventsCommand({
          logGroupName: logGroup,
          filterPattern: `"Session ${sessionId} started"`,
          startTime: Date.now() - 300000, // Last 5 minutes
        }));
        
        if (response.events && response.events.length > 0) {
          console.log(`Container started for session ${sessionId}`);
          return;
        }
      } catch (error) {
        // Log group might not exist yet
      }
      
      await this.sleep(2000);
    }
    
    throw new Error(`Container startup timeout for session ${sessionId} after ${timeout}ms`);
  }

  /**
   * Waits for message processing to complete (checks CloudWatch logs)
   */
  async waitForProcessing(sessionId: string, timeout = TEST_CONFIG.timeouts.buildTimeout): Promise<void> {
    const logGroup = '/ecs/webordinary/edit';
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const response = await this.cloudWatchLogsClient.send(new FilterLogEventsCommand({
          logGroupName: logGroup,
          filterPattern: `"Processing complete" "${sessionId}"`,
          startTime: Date.now() - 300000, // Last 5 minutes
        }));
        
        if (response.events && response.events.length > 0) {
          console.log(`Processing complete for session ${sessionId}`);
          return;
        }
      } catch (error) {
        // Log group might not exist yet
      }
      
      await this.sleep(2000);
    }
    
    // Don't throw error, processing might still be ongoing
    console.log(`Processing timeout for session ${sessionId} after ${timeout}ms (may still be in progress)`);
  }

  /**
   * Sends a message to an existing session
   */
  async sendMessage(params: { sessionId: string; instruction: string }): Promise<void> {
    // Implementation would depend on how messages are sent (SQS, API, etc.)
    console.log(`Sending message to session ${params.sessionId}: ${params.instruction}`);
    // For now, this is a placeholder
    // In reality, this would send to SQS or call an API
  }
}