import { Injectable, Logger } from '@nestjs/common';
import { 
  SQSClient, 
  ReceiveMessageCommand, 
  DeleteMessageCommand,
  SendMessageCommand 
} from '@aws-sdk/client-sqs';
import { 
  DynamoDBClient, 
  PutItemCommand, 
  UpdateItemCommand,
  DeleteItemCommand 
} from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { GitService } from './git.service';
import { EventEmitter } from 'events';
import type { 
  BaseQueueMessage, 
  ClaimRequestMessage, 
  WorkMessage, 
  ResponseMessage
} from '../types/queue-messages';
import { isClaimRequest, isWorkMessage } from '../types/queue-messages';

@Injectable()
export class QueueManagerService extends EventEmitter {
  private readonly logger = new Logger(QueueManagerService.name);
  private readonly sqs: SQSClient;
  private readonly dynamodb: DynamoDBClient;
  
  private currentProjectKey: string | null = null;
  private inputQueueUrl: string | null = null;
  private outputQueueUrl: string | null = null;
  private readonly containerId: string;
  private isPolling: boolean = false;
  private lastActivity: number = Date.now();
  private readonly idleTimeout: number = 30 * 60 * 1000; // 30 minutes

  constructor(
    private readonly gitService: GitService,
  ) {
    super();
    this.sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-west-2' });
    this.dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-west-2' });
    this.containerId = this.generateContainerId();
  }

  /**
   * Initialize the queue manager and start polling
   */
  async initialize(): Promise<void> {
    this.logger.log(`Queue manager initializing with container ID: ${this.containerId}`);
    
    // Start by polling unclaimed queue
    this.isPolling = true;
    this.pollUnclaimedQueue();
    
    // Periodically check if we should release ownership
    setInterval(() => this.checkIdleRelease(), 60000); // Check every minute
  }

  /**
   * Stop polling and cleanup
   */
  async shutdown(): Promise<void> {
    this.logger.log('Shutting down queue manager...');
    this.isPolling = false;
    
    if (this.currentProjectKey) {
      await this.releaseOwnership();
    }
  }

  /**
   * Poll unclaimed queue for new work
   */
  private async pollUnclaimedQueue(): Promise<void> {
    while (this.isPolling && !this.currentProjectKey) {
      try {
        const unclaimedQueueUrl = process.env.UNCLAIMED_QUEUE_URL;
        
        if (!unclaimedQueueUrl) {
          this.logger.warn('UNCLAIMED_QUEUE_URL not set, waiting...');
          await new Promise(resolve => setTimeout(resolve, 30000));
          continue;
        }

        const result = await this.sqs.send(new ReceiveMessageCommand({
          QueueUrl: unclaimedQueueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 20,
          MessageAttributeNames: ['All'],
        }));

        if (result.Messages && result.Messages.length > 0) {
          const message = result.Messages[0];
          const body: BaseQueueMessage = JSON.parse(message.Body || '{}');
          
          if (isClaimRequest(body)) {
            this.logger.log(`Received claim request for ${body.projectId}/${body.userId}`);
            
            // Attempt to claim the project
            const claimed = await this.claimProject(body.projectId, body.userId);
            
            if (claimed) {
              // Delete message from unclaimed queue
              await this.sqs.send(new DeleteMessageCommand({
                QueueUrl: unclaimedQueueUrl,
                ReceiptHandle: message.ReceiptHandle,
              }));
              
              // Start polling project queue
              this.pollProjectQueue();
            } else {
              // Let message return to queue for another container
              this.logger.log('Failed to claim project, continuing to poll unclaimed...');
            }
          }
        }
      } catch (error: any) {
        this.logger.error(`Error polling unclaimed queue: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  /**
   * Attempt to claim ownership of a project
   */
  private async claimProject(projectId: string, userId: string): Promise<boolean> {
    const projectKey = `${projectId}#${userId}`;
    const ownershipTableName = process.env.OWNERSHIP_TABLE_NAME || 'webordinary-container-ownership';
    
    try {
      // Try to claim ownership atomically
      await this.dynamodb.send(new PutItemCommand({
        TableName: ownershipTableName,
        Item: {
          projectKey: { S: projectKey },
          containerId: { S: this.containerId },
          claimedAt: { N: Date.now().toString() },
          lastActivity: { N: Date.now().toString() },
          status: { S: 'active' },
          ttl: { N: Math.floor(Date.now() / 1000 + 3600).toString() }, // 1 hour TTL
        },
        ConditionExpression: 'attribute_not_exists(projectKey)',
      }));
      
      // Successfully claimed!
      this.currentProjectKey = projectKey;
      const accountId = process.env.AWS_ACCOUNT_ID || '942734823970';
      const region = process.env.AWS_REGION || 'us-west-2';
      
      this.inputQueueUrl = `https://sqs.${region}.amazonaws.com/${accountId}/webordinary-input-${projectId}-${userId}`;
      this.outputQueueUrl = `https://sqs.${region}.amazonaws.com/${accountId}/webordinary-output-${projectId}-${userId}`;
      
      this.logger.log(`✅ Successfully claimed ${projectKey}`);
      this.logger.log(`- Input queue: ${this.inputQueueUrl}`);
      this.logger.log(`- Output queue: ${this.outputQueueUrl}`);
      
      // Store claim info (no longer setting environment variables)
      // Other services should call getCurrentClaim() to get this info
      
      // Update git config for this project
      try {
        await this.gitService.configureGitCredentials();
        this.logger.log(`Git config updated for ${projectId}/${userId}`);
      } catch (error: any) {
        this.logger.warn(`Failed to update git config: ${error.message}`);
      }
      
      return true;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        this.logger.log(`Project ${projectKey} already claimed by another container`);
      } else {
        this.logger.error(`Failed to claim project: ${error.message}`);
      }
      return false;
    }
  }

  /**
   * Poll project queue for messages
   */
  private async pollProjectQueue(): Promise<void> {
    this.logger.log(`Starting to poll project queue for ${this.currentProjectKey}`);
    
    while (this.isPolling && this.currentProjectKey && this.inputQueueUrl) {
      try {
        const result = await this.sqs.send(new ReceiveMessageCommand({
          QueueUrl: this.inputQueueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 20,
          MessageAttributeNames: ['All'],
        }));

        if (result.Messages && result.Messages.length > 0) {
          const message = result.Messages[0];
          const body: BaseQueueMessage = JSON.parse(message.Body || '{}');
          
          // Only process work messages
          if (isWorkMessage(body)) {
            this.logger.log(`Received work message for session ${body.sessionId}`);
            
            // Update activity timestamp
            this.lastActivity = Date.now();
            await this.updateActivity();
            
            // Emit message event for processing
            this.emit('message', {
              body: body,
              receiptHandle: message.ReceiptHandle,
              queueUrl: this.inputQueueUrl,
            });
            
            // Delete message from queue after processing
            await this.sqs.send(new DeleteMessageCommand({
              QueueUrl: this.inputQueueUrl,
              ReceiptHandle: message.ReceiptHandle,
            }));
          } else {
            this.logger.warn(`Received non-work message type: ${body.type}`);
            // Delete invalid message
            await this.sqs.send(new DeleteMessageCommand({
              QueueUrl: this.inputQueueUrl,
              ReceiptHandle: message.ReceiptHandle,
            }));
          }
        }
      } catch (error: any) {
        this.logger.error(`Error polling project queue: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    // If we exit the loop, go back to unclaimed
    if (this.isPolling && !this.currentProjectKey) {
      this.logger.log('Released ownership, returning to unclaimed queue');
      this.pollUnclaimedQueue();
    }
  }

  /**
   * Send response to output queue
   */
  async sendResponse(response: ResponseMessage): Promise<void> {
    if (!this.outputQueueUrl) {
      this.logger.error('No output queue URL available');
      return;
    }

    try {
      await this.sqs.send(new SendMessageCommand({
        QueueUrl: this.outputQueueUrl,
        MessageBody: JSON.stringify(response),
        MessageAttributes: {
          commandId: {
            DataType: 'String',
            StringValue: response.commandId || '',
          },
          sessionId: {
            DataType: 'String',
            StringValue: response.sessionId || '',
          },
        },
      }));
      
      this.logger.log(`Response sent to output queue for command ${response.commandId}`);
    } catch (error: any) {
      this.logger.error(`Failed to send response: ${error.message}`);
    }
  }

  /**
   * Update last activity timestamp in ownership table
   */
  private async updateActivity(): Promise<void> {
    if (!this.currentProjectKey) return;
    
    const ownershipTableName = process.env.OWNERSHIP_TABLE_NAME || 'webordinary-container-ownership';
    
    try {
      await this.dynamodb.send(new UpdateItemCommand({
        TableName: ownershipTableName,
        Key: { projectKey: { S: this.currentProjectKey } },
        UpdateExpression: 'SET lastActivity = :now, #ttl = :ttl',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':now': { N: Date.now().toString() },
          ':ttl': { N: Math.floor(Date.now() / 1000 + 3600).toString() },
          ':cid': { S: this.containerId },
        },
        ConditionExpression: 'containerId = :cid',
      }));
    } catch (error: any) {
      this.logger.warn(`Failed to update activity: ${error.message}`);
    }
  }

  /**
   * Check if we should release ownership due to inactivity
   */
  private async checkIdleRelease(): Promise<void> {
    if (!this.currentProjectKey) return;
    
    const idleTime = Date.now() - this.lastActivity;
    
    if (idleTime > this.idleTimeout) {
      this.logger.log(`Container idle for ${Math.round(idleTime / 60000)} minutes, releasing ownership`);
      await this.releaseOwnership();
      
      // Go back to polling unclaimed
      this.pollUnclaimedQueue();
    }
  }

  /**
   * Release ownership of current project
   */
  private async releaseOwnership(): Promise<void> {
    if (!this.currentProjectKey) return;
    
    const ownershipTableName = process.env.OWNERSHIP_TABLE_NAME || 'webordinary-container-ownership';
    
    try {
      await this.dynamodb.send(new DeleteItemCommand({
        TableName: ownershipTableName,
        Key: { projectKey: { S: this.currentProjectKey } },
        ConditionExpression: 'containerId = :cid',
        ExpressionAttributeValues: {
          ':cid': { S: this.containerId },
        },
      }));
      
      this.logger.log(`Released ownership of ${this.currentProjectKey}`);
    } catch (error: any) {
      this.logger.warn(`Failed to release ownership: ${error.message}`);
    }
    
    // Clear state
    this.currentProjectKey = null;
    this.inputQueueUrl = null;
    this.outputQueueUrl = null;
    
    // State cleared (no environment variables to clean up)
  }

  /**
   * Generate a unique container ID
   */
  private generateContainerId(): string {
    const taskArn = process.env.ECS_TASK_ARN;
    
    if (taskArn) {
      // Extract task ID from ARN
      const match = taskArn.match(/task\/([a-f0-9-]+)$/);
      if (match) {
        return `ecs-${match[1].substring(0, 8)}`;
      }
    }
    
    // Fallback to random ID
    return `container-${uuidv4().substring(0, 8)}`;
  }

  /**
   * Get current queue URLs
   */
  getQueueUrls(): { input: string | null; output: string | null } {
    return {
      input: this.inputQueueUrl,
      output: this.outputQueueUrl,
    };
  }

  /**
   * Get current project key
   */
  getCurrentProject(): string | null {
    return this.currentProjectKey;
  }

  /**
   * Get current claim information
   */
  getCurrentClaim(): { projectId: string; userId: string } | null {
    if (!this.currentProjectKey) return null;
    
    const [projectId, userId] = this.currentProjectKey.split('#');
    return { projectId, userId };
  }
}