import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBClient, PutItemCommand, DeleteItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

export interface ActiveJob {
  projectUserKey: string;
  messageId: string;
  taskToken: string;
  receiptHandle: string;
  threadId: string;
  containerId: string;
  startedAt: number;
  ttl: number;
}

@Injectable()
export class ActiveJobService {
  private readonly logger = new Logger(ActiveJobService.name);
  private readonly dynamoClient: DynamoDBClient;
  private readonly tableName: string;
  private ttlRefreshInterval: NodeJS.Timeout | null = null;
  private currentJob: ActiveJob | null = null;

  constructor() {
    this.dynamoClient = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-west-2',
    });
    this.tableName = process.env.ACTIVE_JOBS_TABLE || 'webordinary-active-jobs';
  }

  /**
   * Register an active job in DynamoDB
   */
  async registerJob(job: Omit<ActiveJob, 'startedAt' | 'ttl'>): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const ttl = now + 7200; // 2 hours TTL

    this.currentJob = {
      ...job,
      startedAt: now,
      ttl,
    };

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: {
        projectUserId: { S: job.projectUserKey },
        messageId: { S: job.messageId },
        taskToken: { S: job.taskToken },
        receiptHandle: { S: job.receiptHandle },
        threadId: { S: job.threadId },
        containerId: { S: job.containerId },
        startedAt: { N: now.toString() },
        ttl: { N: ttl.toString() },
      },
    });

    try {
      await this.dynamoClient.send(command);
      this.logger.log(`Registered active job for ${job.projectUserKey}`);
      
      // Start TTL refresh
      this.startTtlRefresh(job.projectUserKey);
    } catch (error: any) {
      this.logger.error(`Failed to register job: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clear an active job from DynamoDB
   */
  async clearJob(projectUserKey: string): Promise<void> {
    this.stopTtlRefresh();

    const command = new DeleteItemCommand({
      TableName: this.tableName,
      Key: {
        projectUserId: { S: projectUserKey },
      },
    });

    try {
      await this.dynamoClient.send(command);
      this.logger.log(`Cleared active job for ${projectUserKey}`);
      this.currentJob = null;
    } catch (error: any) {
      this.logger.error(`Failed to clear job: ${error.message}`);
      // Don't throw - job might already be cleared
    }
  }

  /**
   * Start refreshing TTL to prevent expiration during long tasks
   * Called every 30 seconds along with heartbeats
   */
  private startTtlRefresh(projectUserKey: string): void {
    this.stopTtlRefresh();

    this.ttlRefreshInterval = setInterval(async () => {
      try {
        await this.refreshTtl(projectUserKey);
      } catch (error: any) {
        this.logger.error(`Failed to refresh TTL: ${error.message}`);
      }
    }, 30000); // Every 30 seconds with heartbeat
  }

  /**
   * Stop TTL refresh interval
   */
  private stopTtlRefresh(): void {
    if (this.ttlRefreshInterval) {
      clearInterval(this.ttlRefreshInterval);
      this.ttlRefreshInterval = null;
    }
  }

  /**
   * Refresh TTL for active job
   */
  private async refreshTtl(projectUserKey: string): Promise<void> {
    const newTtl = Math.floor(Date.now() / 1000) + 7200; // Extend by 2 hours

    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: {
        projectUserId: { S: projectUserKey },
      },
      UpdateExpression: 'SET #ttl = :newTtl',
      ExpressionAttributeNames: {
        '#ttl': 'ttl',
      },
      ExpressionAttributeValues: {
        ':newTtl': { N: newTtl.toString() },
      },
    });

    await this.dynamoClient.send(command);
    this.logger.debug(`Refreshed TTL for ${projectUserKey} to ${newTtl}`);
  }

  /**
   * Get current job info
   */
  getCurrentJob(): ActiveJob | null {
    return this.currentJob;
  }

  /**
   * Clear everything on shutdown
   */
  async cleanup(): Promise<void> {
    this.stopTtlRefresh();
    if (this.currentJob) {
      await this.clearJob(this.currentJob.projectUserKey);
    }
  }
}