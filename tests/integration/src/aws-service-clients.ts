import {
  ECSClient,
  DescribeServicesCommand,
  UpdateServiceCommand,
  ListTasksCommand,
  DescribeTasksCommand,
  StopTaskCommand
} from '@aws-sdk/client-ecs';
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  DeleteItemCommand,
  ScanCommand,
  UpdateItemCommand
} from '@aws-sdk/client-dynamodb';
import {
  CloudWatchClient,
  PutMetricDataCommand,
  GetMetricStatisticsCommand,
  StandardUnit
} from '@aws-sdk/client-cloudwatch';
import {
  ElasticLoadBalancingV2Client,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

import { TEST_CONFIG, TestSession } from '../config/test-config.js';

/**
 * Wrapper for ECS operations with error handling and retries
 */
export class ECSServiceClient {
  private readonly client: ECSClient;

  constructor() {
    this.client = new ECSClient({
      region: TEST_CONFIG.aws.region
    });
  }

  async getServiceStatus(serviceName: string): Promise<{
    runningCount: number;
    desiredCount: number;
    pendingCount: number;
    status: string;
  }> {
    try {
      const response = await this.client.send(new DescribeServicesCommand({
        cluster: TEST_CONFIG.services.clusterName,
        services: [serviceName]
      }));

      const service = response.services?.[0];
      if (!service) {
        throw new Error(`Service not found: ${serviceName}`);
      }

      return {
        runningCount: service.runningCount || 0,
        desiredCount: service.desiredCount || 0,
        pendingCount: service.pendingCount || 0,
        status: service.status || 'UNKNOWN'
      };
    } catch (error) {
      throw new Error(`Failed to get service status for ${serviceName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async updateServiceTaskCount(serviceName: string, desiredCount: number): Promise<void> {
    try {
      await this.client.send(new UpdateServiceCommand({
        cluster: TEST_CONFIG.services.clusterName,
        service: serviceName,
        desiredCount: desiredCount
      }));
    } catch (error) {
      throw new Error(`Failed to update service ${serviceName} to ${desiredCount} tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async listServiceTasks(serviceName: string): Promise<string[]> {
    try {
      const response = await this.client.send(new ListTasksCommand({
        cluster: TEST_CONFIG.services.clusterName,
        serviceName: serviceName
      }));

      return response.taskArns || [];
    } catch (error) {
      throw new Error(`Failed to list tasks for service ${serviceName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getTaskDetails(taskArns: string[]): Promise<Array<{
    taskArn: string;
    lastStatus: string;
    healthStatus: string;
    createdAt: Date;
    startedAt?: Date;
  }>> {
    if (taskArns.length === 0) return [];

    try {
      const response = await this.client.send(new DescribeTasksCommand({
        cluster: TEST_CONFIG.services.clusterName,
        tasks: taskArns
      }));

      return (response.tasks || []).map(task => ({
        taskArn: task.taskArn!,
        lastStatus: task.lastStatus || 'UNKNOWN',
        healthStatus: task.healthStatus || 'UNKNOWN',
        createdAt: task.createdAt!,
        startedAt: task.startedAt
      }));
    } catch (error) {
      throw new Error(`Failed to get task details: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async killTask(taskArn: string, reason = 'Integration test cleanup'): Promise<void> {
    try {
      await this.client.send(new StopTaskCommand({
        cluster: TEST_CONFIG.services.clusterName,
        task: taskArn,
        reason: reason
      }));
    } catch (error) {
      throw new Error(`Failed to kill task ${taskArn}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async waitForServiceStable(serviceName: string, timeoutMs = 60000): Promise<void> {
    const startTime = Date.now();
    const pollingInterval = 3000; // 3 seconds

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getServiceStatus(serviceName);

      if (status.runningCount === status.desiredCount && status.pendingCount === 0) {
        return;
      }

      await new Promise(resolve => setTimeout(resolve, pollingInterval));
    }

    throw new Error(`Service ${serviceName} did not stabilize within ${timeoutMs}ms`);
  }
}

/**
 * Wrapper for DynamoDB operations with batch processing and retries
 */
export class DynamoDBServiceClient {
  private readonly client: DynamoDBClient;
  private readonly tableName: string;

  constructor() {
    this.client = new DynamoDBClient({
      region: TEST_CONFIG.aws.region
    });
    this.tableName = TEST_CONFIG.services.dynamoTableName;
  }

  async createSession(session: Omit<TestSession, 'sessionId'> & { sessionId?: string }): Promise<TestSession> {
    const completeSession: TestSession = {
      sessionId: session.sessionId || this.generateSessionId(),
      userId: session.userId,
      clientId: session.clientId,
      threadId: session.threadId,
      status: session.status,
      previewUrl: session.previewUrl || `${TEST_CONFIG.endpoints.alb}/session/${session.sessionId}`,
      lastActivity: session.lastActivity,
      ttl: session.ttl,
      metadata: session.metadata
    };

    try {
      await this.client.send(new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(completeSession),
        ConditionExpression: 'attribute_not_exists(sessionId)'
      }));

      return completeSession;
    } catch (error) {
      throw new Error(`Failed to create session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getSession(sessionId: string, userId: string): Promise<TestSession | null> {
    try {
      const response = await this.client.send(new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({ sessionId, userId })
      }));

      if (!response.Item) {
        return null;
      }

      return unmarshall(response.Item) as TestSession;
    } catch (error) {
      throw new Error(`Failed to get session ${sessionId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async updateSessionStatus(sessionId: string, userId: string, status: TestSession['status']): Promise<void> {
    try {
      await this.client.send(new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({ sessionId, userId }),
        UpdateExpression: 'SET #status = :status, lastActivity = :lastActivity',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: marshall({ ':status': status, ':lastActivity': Date.now() })
      }));
    } catch (error) {
      throw new Error(`Failed to update session status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async deleteSession(sessionId: string, userId: string): Promise<void> {
    try {
      await this.client.send(new DeleteItemCommand({
        TableName: this.tableName,
        Key: marshall({ sessionId, userId })
      }));
    } catch (error) {
      throw new Error(`Failed to delete session ${sessionId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async scanTestSessions(): Promise<TestSession[]> {
    try {
      const response = await this.client.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'begins_with(userId, :prefix)',
        ExpressionAttributeValues: marshall({
          ':prefix': TEST_CONFIG.testData.testPrefix
        })
      }));

      if (!response.Items) {
        return [];
      }

      return response.Items.map(item => unmarshall(item) as TestSession);
    } catch (error) {
      throw new Error(`Failed to scan test sessions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async batchDeleteSessions(sessions: Array<{ sessionId: string; userId: string }>): Promise<void> {
    // DynamoDB batch operations are limited to 25 items
    const chunks = this.chunkArray(sessions, 25);

    for (const chunk of chunks) {
      try {
        // Using individual deletes for simplicity since batch write is complex
        await Promise.all(
          chunk.map(session => this.deleteSession(session.sessionId, session.userId))
        );
      } catch (error) {
        console.warn(`Failed to delete batch of sessions: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  private generateSessionId(): string {
    return `${TEST_CONFIG.testData.testPrefix}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

/**
 * Wrapper for CloudWatch operations for metrics and monitoring
 */
export class CloudWatchServiceClient {
  private readonly client: CloudWatchClient;

  constructor() {
    this.client = new CloudWatchClient({
      region: TEST_CONFIG.aws.region
    });
  }

  async publishTestMetrics(testName: string, metrics: {
    duration?: number;
    success?: boolean;
    containerStartupTime?: number;
    sessionCreationTime?: number;
    cost?: number;
  }): Promise<void> {
    const metricData = [];

    if (metrics.duration !== undefined) {
      metricData.push({
        MetricName: 'TestDuration',
        Value: metrics.duration,
        Unit: StandardUnit.Milliseconds,
        Dimensions: [{ Name: 'TestName', Value: testName }]
      });
    }

    if (metrics.success !== undefined) {
      metricData.push({
        MetricName: 'TestSuccess',
        Value: metrics.success ? 1 : 0,
        Unit: StandardUnit.Count,
        Dimensions: [{ Name: 'TestName', Value: testName }]
      });
    }

    if (metrics.containerStartupTime !== undefined) {
      metricData.push({
        MetricName: 'ContainerStartupTime',
        Value: metrics.containerStartupTime,
        Unit: StandardUnit.Milliseconds,
        Dimensions: [{ Name: 'TestName', Value: testName }]
      });
    }

    if (metrics.sessionCreationTime !== undefined) {
      metricData.push({
        MetricName: 'SessionCreationTime',
        Value: metrics.sessionCreationTime,
        Unit: StandardUnit.Milliseconds,
        Dimensions: [{ Name: 'TestName', Value: testName }]
      });
    }

    if (metrics.cost !== undefined) {
      metricData.push({
        MetricName: 'TestCost',
        Value: metrics.cost,
        Unit: StandardUnit.None,
        Dimensions: [{ Name: 'TestName', Value: testName }]
      });
    }

    if (metricData.length === 0) {
      return;
    }

    try {
      await this.client.send(new PutMetricDataCommand({
        Namespace: 'Webordinary/IntegrationTests',
        MetricData: metricData
      }));
    } catch (error) {
      console.warn(`Failed to publish CloudWatch metrics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getMetricStatistics(metricName: string, startTime: Date, endTime: Date): Promise<Array<{
    timestamp: Date;
    value: number;
  }>> {
    try {
      const response = await this.client.send(new GetMetricStatisticsCommand({
        Namespace: 'Webordinary/IntegrationTests',
        MetricName: metricName,
        StartTime: startTime,
        EndTime: endTime,
        Period: 300, // 5 minutes
        Statistics: ['Average', 'Maximum', 'Sum']
      }));

      return (response.Datapoints || [])
        .map(point => ({
          timestamp: point.Timestamp!,
          value: point.Average || point.Maximum || point.Sum || 0
        }))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    } catch (error) {
      throw new Error(`Failed to get metric statistics for ${metricName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getActiveSessionMetric(): Promise<number> {
    try {
      const response = await this.client.send(new GetMetricStatisticsCommand({
        Namespace: 'Webordinary/EditSessions',
        MetricName: 'ActiveSessionCount',
        StartTime: new Date(Date.now() - 5 * 60 * 1000), // Last 5 minutes
        EndTime: new Date(),
        Period: 60,
        Statistics: ['Maximum']
      }));

      const latest = response.Datapoints?.sort((a, b) => b.Timestamp!.getTime() - a.Timestamp!.getTime())[0];
      return latest?.Maximum || 0;
    } catch (error) {
      console.warn(`Failed to get active session metric: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return 0;
    }
  }
}

/**
 * Wrapper for ALB operations for health checking and routing verification
 */
export class ALBServiceClient {
  private readonly client: ElasticLoadBalancingV2Client;

  constructor() {
    this.client = new ElasticLoadBalancingV2Client({
      region: TEST_CONFIG.aws.region
    });
  }

  async getTargetGroupHealth(targetGroupName: string): Promise<Array<{
    targetId: string;
    port: number;
    healthStatus: string;
    reason?: string;
  }>> {
    try {
      // First, get the target group ARN
      const tgResponse = await this.client.send(new DescribeTargetGroupsCommand({
        Names: [targetGroupName]
      }));

      const targetGroup = tgResponse.TargetGroups?.[0];
      if (!targetGroup) {
        throw new Error(`Target group not found: ${targetGroupName}`);
      }

      // Then get the health status
      const healthResponse = await this.client.send(new DescribeTargetHealthCommand({
        TargetGroupArn: targetGroup.TargetGroupArn
      }));

      return (healthResponse.TargetHealthDescriptions || []).map(desc => ({
        targetId: desc.Target?.Id || 'unknown',
        port: desc.Target?.Port || 0,
        healthStatus: desc.TargetHealth?.State || 'unknown',
        reason: desc.TargetHealth?.Reason
      }));
    } catch (error) {
      throw new Error(`Failed to get target group health for ${targetGroupName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Centralized AWS service manager
 */
export class AWSServiceManager {
  public readonly ecs: ECSServiceClient;
  public readonly dynamo: DynamoDBServiceClient;
  public readonly cloudWatch: CloudWatchServiceClient;
  public readonly alb: ALBServiceClient;

  constructor() {
    this.ecs = new ECSServiceClient();
    this.dynamo = new DynamoDBServiceClient();
    this.cloudWatch = new CloudWatchServiceClient();
    this.alb = new ALBServiceClient();
  }

  async healthCheck(): Promise<{ service: string; healthy: boolean; details?: string }[]> {
    const checks = [];

    // ECS health check
    try {
      await this.ecs.getServiceStatus(TEST_CONFIG.services.editService);
      checks.push({ service: 'ECS', healthy: true });
    } catch (error) {
      checks.push({ service: 'ECS', healthy: false, details: error instanceof Error ? error.message : 'Unknown error' });
    }

    // DynamoDB health check
    try {
      await this.dynamo.scanTestSessions();
      checks.push({ service: 'DynamoDB', healthy: true });
    } catch (error) {
      checks.push({ service: 'DynamoDB', healthy: false, details: error instanceof Error ? error.message : 'Unknown error' });
    }

    // CloudWatch health check
    try {
      await this.cloudWatch.getActiveSessionMetric();
      checks.push({ service: 'CloudWatch', healthy: true });
    } catch (error) {
      checks.push({ service: 'CloudWatch', healthy: false, details: error instanceof Error ? error.message : 'Unknown error' });
    }

    return checks;
  }
}