import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { SqsMessageHandler, SqsConsumerEventHandler } from '@ssut/nestjs-sqs';
import { Message, SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient, PutItemCommand, UpdateItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageProcessor } from './message-processor.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

interface ClaimRequestMessage {
  type: 'CLAIM_REQUEST';
  projectId: string;
  userId: string;
  threadId: string;
  messageId: string;
  queueUrl: string;
  timestamp: string;
}

interface StepFunctionMessage {
  taskToken: string;
  messageId: string;
  instruction: string;
  threadId: string;
  projectId: string;
  userId: string;
  attachments?: any[];
}

@Injectable()
export class GenericContainerService implements OnModuleDestroy {
  private readonly logger = new Logger(GenericContainerService.name);
  private readonly sqsClient: SQSClient;
  private readonly dynamoClient: DynamoDBClient;
  private readonly containerId: string;
  
  private currentProjectKey: string | null = null;
  private projectQueueUrl: string | null = null;
  private interruptQueueUrl: string | null = null;
  private isPollingProject = false;
  private isPollingInterrupts = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private interruptPollAbortController: AbortController | null = null;
  private lastActivity: number = Date.now();
  // @todo(sh): Consider user session length for optimal idle timeout
  // Current: 5 minutes for quick release, but may want longer for active users
  private readonly idleTimeout = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly messageProcessor: MessageProcessor,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.sqsClient = new SQSClient({ 
      region: process.env.AWS_REGION || 'us-west-2' 
    });
    this.dynamoClient = new DynamoDBClient({ 
      region: process.env.AWS_REGION || 'us-west-2' 
    });
    this.containerId = this.generateContainerId();
    
    this.logger.log(`Generic container initialized with ID: ${this.containerId}`);
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down generic container...');
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    if (this.currentProjectKey) {
      await this.releaseOwnership();
    }
  }

  /**
   * Handle messages from unclaimed queue
   */
  @SqsMessageHandler('unclaimed-queue', false)
  async handleUnclaimedMessage(message: Message) {
    if (!message.Body) {
      this.logger.error('Received message with no body from unclaimed queue');
      return;
    }

    const body = JSON.parse(message.Body);
    
    if (body.type !== 'CLAIM_REQUEST') {
      this.logger.warn(`Unexpected message type in unclaimed queue: ${body.type}`);
      return;
    }

    const claimRequest = body as ClaimRequestMessage;
    this.logger.log(`Received claim request for ${claimRequest.projectId}/${claimRequest.userId}`);

    // Attempt to claim the project+user
    const claimed = await this.claimProject(claimRequest.projectId, claimRequest.userId);
    
    if (claimed) {
      this.logger.log(`Successfully claimed ${claimRequest.projectId}/${claimRequest.userId}`);
      
      // Store queue URLs for polling
      this.projectQueueUrl = claimRequest.queueUrl;
      
      // Set interrupt queue URL based on project/user
      const region = process.env.AWS_REGION || 'us-west-2';
      const accountId = process.env.AWS_ACCOUNT_ID || '942734823970';
      this.interruptQueueUrl = `https://sqs.${region}.amazonaws.com/${accountId}/webordinary-interrupts-${claimRequest.projectId}-${claimRequest.userId}`;
      
      // Start polling both queues (work and interrupts)
      this.startPollingProjectQueue();
      this.startPollingInterruptQueue();
      
      // Message auto-deleted by SQS consumer on success
    } else {
      // Let another container try - don't delete message
      this.logger.log(`Failed to claim ${claimRequest.projectId}/${claimRequest.userId}, letting another container try`);
      throw new Error('Failed to claim project');
    }
  }

  /**
   * Attempt to claim ownership of a project+user
   */
  private async claimProject(projectId: string, userId: string): Promise<boolean> {
    const projectKey = `${projectId}#${userId}`;
    const ownershipTable = process.env.OWNERSHIP_TABLE_NAME || 'webordinary-container-ownership';
    
    try {
      // Atomic claim with conditional write
      await this.dynamoClient.send(new PutItemCommand({
        TableName: ownershipTable,
        Item: {
          projectKey: { S: projectKey },
          containerId: { S: this.containerId },
          claimedAt: { N: Date.now().toString() },
          lastActivity: { N: Date.now().toString() },
          status: { S: 'active' },
          ttl: { N: Math.floor(Date.now() / 1000 + 3600).toString() }, // 1 hour TTL
        },
        ConditionExpression: 'attribute_not_exists(projectKey) OR #ttl < :now',
        ExpressionAttributeNames: {
          '#ttl': 'ttl'
        },
        ExpressionAttributeValues: {
          ':now': { N: Math.floor(Date.now() / 1000).toString() }
        }
      }));
      
      this.currentProjectKey = projectKey;
      this.lastActivity = Date.now();
      
      // Start idle checker
      this.startIdleChecker();
      
      return true;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        this.logger.log(`Project ${projectKey} already claimed by another container`);
        return false;
      }
      this.logger.error(`Error claiming project: ${error.message}`);
      return false;
    }
  }

  /**
   * Start polling the project-specific FIFO queue
   */
  private startPollingProjectQueue() {
    if (!this.projectQueueUrl || !this.currentProjectKey) {
      this.logger.error('Cannot start polling without queue URL and project key');
      return;
    }

    this.isPollingProject = true;
    this.logger.log(`Starting to poll ${this.projectQueueUrl}`);

    // Poll continuously
    this.pollProjectQueue();
  }

  /**
   * Poll the project FIFO queue for Step Functions messages
   */
  private async pollProjectQueue() {
    while (this.isPollingProject && this.projectQueueUrl) {
      try {
        const result = await this.sqsClient.send(new ReceiveMessageCommand({
          QueueUrl: this.projectQueueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 20, // Long polling
          MessageAttributeNames: ['All'],
          AttributeNames: ['All'],
        }));

        if (result.Messages && result.Messages.length > 0) {
          const message = result.Messages[0];
          const body: StepFunctionMessage = JSON.parse(message.Body || '{}');
          
          this.logger.log(`Received Step Functions message for ${body.projectId}/${body.userId}`);
          
          // Update activity
          this.lastActivity = Date.now();
          await this.updateActivity();
          
          // Process with the message processor
          try {
            await this.messageProcessor.handleMessage(message);
            
            // Delete message on success
            await this.sqsClient.send(new DeleteMessageCommand({
              QueueUrl: this.projectQueueUrl,
              ReceiptHandle: message.ReceiptHandle!,
            }));
          } catch (error: any) {
            this.logger.error(`Error processing message: ${error.message}`);
            // Message will return to queue after visibility timeout
          }
        }
      } catch (error: any) {
        this.logger.error(`Error polling project queue: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  /**
   * Start polling the interrupt queue for immediate interruptions
   */
  private startPollingInterruptQueue() {
    if (!this.interruptQueueUrl || !this.currentProjectKey) {
      this.logger.error('Cannot start polling interrupts without queue URL and project key');
      return;
    }

    this.isPollingInterrupts = true;
    this.interruptPollAbortController = new AbortController();
    this.logger.log(`Starting to poll interrupt queue: ${this.interruptQueueUrl}`);

    // Poll interrupt queue in parallel (non-blocking)
    this.pollInterruptQueue();
  }

  /**
   * Poll the interrupt queue continuously
   */
  private async pollInterruptQueue() {
    while (this.isPollingInterrupts && this.interruptQueueUrl && !this.interruptPollAbortController?.signal.aborted) {
      try {
        const result = await this.sqsClient.send(new ReceiveMessageCommand({
          QueueUrl: this.interruptQueueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 5, // Shorter polling for faster interrupt response
          MessageAttributeNames: ['All'],
          AttributeNames: ['All'],
        }));

        if (result.Messages && result.Messages.length > 0) {
          const message = result.Messages[0];
          const body = JSON.parse(message.Body || '{}');
          
          this.logger.warn(`Received interrupt: ${body.reason}`);
          
          // Emit interrupt event for the message processor
          this.eventEmitter.emit('interrupt', {
            messageId: body.interruptingMessageId,
            newThreadId: body.newThreadId,
            reason: body.reason,
            timestamp: body.timestamp,
          });
          
          // Delete the interrupt message
          await this.sqsClient.send(new DeleteMessageCommand({
            QueueUrl: this.interruptQueueUrl,
            ReceiptHandle: message.ReceiptHandle!,
          }));
          
          // Stop polling after interrupt is handled
          this.stopPollingInterruptQueue();
          break;
        }
      } catch (error: any) {
        if (!error.message?.includes('abort')) {
          this.logger.error(`Error polling interrupt queue: ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  /**
   * Stop polling the interrupt queue
   */
  private stopPollingInterruptQueue() {
    this.isPollingInterrupts = false;
    if (this.interruptPollAbortController) {
      this.interruptPollAbortController.abort();
      this.interruptPollAbortController = null;
    }
  }

  /**
   * Update activity timestamp in ownership table
   */
  private async updateActivity() {
    if (!this.currentProjectKey) return;
    
    const ownershipTable = process.env.OWNERSHIP_TABLE_NAME || 'webordinary-container-ownership';
    
    try {
      await this.dynamoClient.send(new UpdateItemCommand({
        TableName: ownershipTable,
        Key: {
          projectKey: { S: this.currentProjectKey }
        },
        UpdateExpression: 'SET lastActivity = :now, #ttl = :ttl',
        ExpressionAttributeNames: {
          '#ttl': 'ttl'
        },
        ExpressionAttributeValues: {
          ':now': { N: Date.now().toString() },
          ':ttl': { N: Math.floor(Date.now() / 1000 + 3600).toString() }
        }
      }));
    } catch (error: any) {
      this.logger.error(`Failed to update activity: ${error.message}`);
    }
  }

  /**
   * Check for idle timeout and release ownership
   * @todo(sh): Optimize check frequency based on idle timeout duration
   */
  private startIdleChecker() {
    // Check every minute
    this.pollInterval = setInterval(async () => {
      const idleTime = Date.now() - this.lastActivity;
      
      if (idleTime > this.idleTimeout) {
        this.logger.log(`Container idle for ${Math.floor(idleTime / 60000)} minutes, releasing ownership`);
        await this.releaseOwnership();
      }
    }, 60000);
  }

  /**
   * Release ownership of current project
   */
  private async releaseOwnership() {
    if (!this.currentProjectKey) return;
    
    this.logger.log(`Releasing ownership of ${this.currentProjectKey}`);
    this.isPollingProject = false;
    this.stopPollingInterruptQueue();
    
    const ownershipTable = process.env.OWNERSHIP_TABLE_NAME || 'webordinary-container-ownership';
    
    try {
      await this.dynamoClient.send(new DeleteItemCommand({
        TableName: ownershipTable,
        Key: {
          projectKey: { S: this.currentProjectKey }
        }
      }));
    } catch (error: any) {
      this.logger.error(`Failed to release ownership: ${error.message}`);
    }
    
    this.currentProjectKey = null;
    this.projectQueueUrl = null;
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Handle interrupt events
   */
  @OnEvent('interrupt')
  async handleInterrupt(interrupt: any) {
    // When interrupted, release ownership and resume polling for new work
    this.logger.warn(`Handling interrupt, releasing ownership and resuming polling`);
    await this.releaseOwnership();
    
    // After releasing, the container goes back to polling unclaimed queue
    // The unclaimed queue handler will pick up new work automatically
  }

  /**
   * Generate unique container ID
   */
  private generateContainerId(): string {
    return `container-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get container metadata
   */
  getContainerMetadata() {
    return {
      containerId: this.containerId,
      currentProject: this.currentProjectKey,
      isActive: this.isPollingProject,
      lastActivity: this.lastActivity,
    };
  }
}