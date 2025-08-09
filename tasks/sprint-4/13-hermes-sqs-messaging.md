# Task 13: Update Hermes to Send Messages via SQS

## Objective
Update Hermes to send edit commands to the single SQS queue per container (user+project), replacing HTTP API calls with SQS message passing.

## Requirements

### SQS Integration with NestJS
1. **Queue Management**:
   - Create one queue set per container (user+project)
   - Queue naming: `webordinary-{input|output|dlq}-{clientId}-{projectId}-{userId}`
   - Store queue URLs in DynamoDB for container lifecycle
   - Use @ssut/nestjs-sqs for clean NestJS integration

2. **Message Sending**:
   - Format commands as SQS messages with session context
   - Send to single container queue (multiple sessions share queue)
   - Include chat thread ID for git branch management

3. **Response Processing**:
   - Poll output queue for responses
   - Correlate responses with requests via commandId
   - Handle timeouts and interruption notifications

## Implementation

### NestJS SQS Module Configuration

```typescript
// hermes/src/modules/sqs/sqs.module.ts
import { Module } from '@nestjs/common';
import { SqsModule } from '@ssut/nestjs-sqs';
import { QueueManagerService } from './queue-manager.service';
import { CommandExecutorService } from './command-executor.service';

@Module({
  imports: [
    SqsModule.register({
      consumers: [], // Dynamic consumers added at runtime
      producers: [], // Dynamic producers added at runtime
    }),
  ],
  providers: [QueueManagerService, CommandExecutorService],
  exports: [QueueManagerService, CommandExecutorService],
})
export class SqsMessagingModule {}
```

### Queue Manager Service

```typescript
// hermes/src/modules/sqs/queue-manager.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SQSClient, CreateQueueCommand, DeleteQueueCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

@Injectable()
export class QueueManagerService {
  private readonly logger = new Logger(QueueManagerService.name);
  private readonly sqs: SQSClient;
  private readonly dynamodb: DynamoDBDocumentClient;
  private containerQueues: Map<string, ContainerQueues> = new Map();

  constructor() {
    this.sqs = new SQSClient({ region: 'us-west-2' });
    const ddbClient = new DynamoDBClient({ region: 'us-west-2' });
    this.dynamodb = DynamoDBDocumentClient.from(ddbClient);
  }

  async getOrCreateContainerQueues(
    clientId: string,
    projectId: string,
    userId: string
  ): Promise<ContainerQueues> {
    const containerId = `${clientId}-${projectId}-${userId}`;
    
    // Check cache first
    if (this.containerQueues.has(containerId)) {
      return this.containerQueues.get(containerId);
    }

    // Check DynamoDB for existing queues
    const existing = await this.getQueuesFromDynamoDB(containerId);
    if (existing) {
      this.containerQueues.set(containerId, existing);
      return existing;
    }

    // Create new queues for container
    const queues = await this.createContainerQueues(clientId, projectId, userId);
    
    // Save to DynamoDB
    await this.saveQueuesToDynamoDB(containerId, queues);
    
    // Cache locally
    this.containerQueues.set(containerId, queues);
    
    return queues;
  }

  private async createContainerQueues(
    clientId: string,
    projectId: string,
    userId: string
  ): Promise<ContainerQueues> {
    const baseName = `${clientId}-${projectId}-${userId}`;
    
    this.logger.log(`Creating queues for container: ${baseName}`);
    
    // Create all three queues in parallel
    const [inputQueue, outputQueue, dlq] = await Promise.all([
      this.createQueue(`webordinary-input-${baseName}`),
      this.createQueue(`webordinary-output-${baseName}`),
      this.createQueue(`webordinary-dlq-${baseName}`)
    ]);
    
    // Configure DLQ redrive policy
    await this.setRedrivePolicy(inputQueue.QueueUrl, dlq.QueueArn);
    
    return {
      containerId: baseName,
      inputUrl: inputQueue.QueueUrl,
      outputUrl: outputQueue.QueueUrl,
      dlqUrl: dlq.QueueUrl,
      createdAt: Date.now()
    };
  }

  private async createQueue(queueName: string) {
    try {
      const result = await this.sqs.send(new CreateQueueCommand({
        QueueName: queueName,
        Attributes: {
          MessageRetentionPeriod: '345600', // 4 days
          ReceiveMessageWaitTimeSeconds: '20', // Long polling
          VisibilityTimeout: '300' // 5 minutes
        }
      }));
      
      // Get queue ARN
      const attrs = await this.sqs.send(new GetQueueAttributesCommand({
        QueueUrl: result.QueueUrl,
        AttributeNames: ['QueueArn']
      }));
      
      return {
        QueueUrl: result.QueueUrl,
        QueueArn: attrs.Attributes.QueueArn
      };
    } catch (error) {
      if (error.name === 'QueueAlreadyExists') {
        // Queue exists, get its URL
        const urlResult = await this.sqs.send(new GetQueueUrlCommand({
          QueueName: queueName
        }));
        return { QueueUrl: urlResult.QueueUrl, QueueArn: '' };
      }
      throw error;
    }
  }

  private async setRedrivePolicy(queueUrl: string, dlqArn: string) {
    await this.sqs.send(new SetQueueAttributesCommand({
      QueueUrl: queueUrl,
      Attributes: {
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: dlqArn,
          maxReceiveCount: 3
        })
      }
    }));
  }

  private async saveQueuesToDynamoDB(containerId: string, queues: ContainerQueues) {
    await this.dynamodb.send(new PutCommand({
      TableName: 'webordinary-container-queues',
      Item: {
        containerId,
        ...queues,
        ttl: Math.floor(Date.now() / 1000) + 86400 // 24 hour TTL
      }
    }));
  }

  private async getQueuesFromDynamoDB(containerId: string): Promise<ContainerQueues | null> {
    const result = await this.dynamodb.send(new GetCommand({
      TableName: 'webordinary-container-queues',
      Key: { containerId }
    }));
    
    return result.Item as ContainerQueues || null;
  }

  async deleteContainerQueues(clientId: string, projectId: string, userId: string): Promise<void> {
    const baseName = `${clientId}-${projectId}-${userId}`;
    
    this.logger.log(`Deleting queues for container: ${baseName}`);
    
    await Promise.all([
      this.deleteQueue(`webordinary-input-${baseName}`),
      this.deleteQueue(`webordinary-output-${baseName}`),
      this.deleteQueue(`webordinary-dlq-${baseName}`)
    ]);
    
    // Remove from cache
    this.containerQueues.delete(baseName);
  }

  private async deleteQueue(queueName: string) {
    try {
      const urlResult = await this.sqs.send(new GetQueueUrlCommand({
        QueueName: queueName
      }));
      
      await this.sqs.send(new DeleteQueueCommand({
        QueueUrl: urlResult.QueueUrl
      }));
    } catch (error) {
      this.logger.debug(`Queue ${queueName} not found or already deleted`);
    }
  }
}

interface ContainerQueues {
  containerId: string;
  inputUrl: string;
  outputUrl: string;
  dlqUrl: string;
  createdAt: number;
}
```

### Command Executor Service

```typescript
// hermes/src/modules/sqs/command-executor.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SqsService } from '@ssut/nestjs-sqs';
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CommandExecutorService {
  private readonly logger = new Logger(CommandExecutorService.name);
  private readonly sqs: SQSClient;

  constructor(private readonly sqsService: SqsService) {
    this.sqs = new SQSClient({ region: 'us-west-2' });
  }

  async sendEditCommand(
    queues: ContainerQueues,
    sessionId: string,
    chatThreadId: string,
    instruction: string,
    userEmail: string,
    context?: any
  ): Promise<string> {
    const commandId = uuidv4();
    
    const message: EditMessage = {
      sessionId,
      commandId,
      timestamp: Date.now(),
      type: 'edit',
      instruction,
      userEmail,
      chatThreadId,
      context: {
        branch: `thread-${chatThreadId}`,
        ...context
      }
    };

    this.logger.log(`Sending command ${commandId} to container ${queues.containerId}`);

    await this.sqs.send(new SendMessageCommand({
      QueueUrl: queues.inputUrl,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        commandId: { DataType: 'String', StringValue: commandId },
        sessionId: { DataType: 'String', StringValue: sessionId },
        type: { DataType: 'String', StringValue: 'edit' }
      }
    }));

    return commandId;
  }

  async waitForResponse(
    outputQueueUrl: string,
    commandId: string,
    timeout: number = 30000
  ): Promise<ResponseMessage> {
    const endTime = Date.now() + timeout;
    
    while (Date.now() < endTime) {
      const result = await this.sqs.send(new ReceiveMessageCommand({
        QueueUrl: outputQueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 5,
        MessageAttributeNames: ['All']
      }));

      if (result.Messages) {
        for (const message of result.Messages) {
          const body = JSON.parse(message.Body);
          
          if (body.commandId === commandId) {
            // Delete message from queue
            await this.sqs.send(new DeleteMessageCommand({
              QueueUrl: outputQueueUrl,
              ReceiptHandle: message.ReceiptHandle
            }));
            
            this.logger.log(`Received response for command ${commandId}: ${body.success ? 'success' : 'failed'}`);
            
            return body as ResponseMessage;
          }
        }
      }
      
      // Short delay before next poll
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error(`Response timeout for command ${commandId}`);
  }

  async sendInterruptCommand(
    queues: ContainerQueues,
    sessionId: string,
    chatThreadId: string
  ): Promise<void> {
    const message = {
      sessionId,
      commandId: uuidv4(),
      timestamp: Date.now(),
      type: 'interrupt',
      chatThreadId,
      priority: 'high'
    };

    await this.sqs.send(new SendMessageCommand({
      QueueUrl: queues.inputUrl,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        type: { DataType: 'String', StringValue: 'interrupt' },
        priority: { DataType: 'String', StringValue: 'high' }
      }
    }));
  }
}

// Message interfaces
interface EditMessage {
  sessionId: string;
  commandId: string;
  timestamp: number;
  type: 'edit' | 'build' | 'commit' | 'push' | 'preview' | 'interrupt';
  instruction?: string;
  userEmail?: string;
  chatThreadId: string;
  context: {
    branch: string;
    lastCommit?: string;
    filesModified?: string[];
  };
}

interface ResponseMessage {
  sessionId: string;
  commandId: string;
  timestamp: number;
  success: boolean;
  summary?: string;
  filesChanged?: string[];
  error?: string;
  previewUrl?: string;
  interrupted?: boolean;
}
```

### Integration with Email Processing

```typescript
// hermes/src/modules/email/email-processor.service.ts
@Injectable()
export class EmailProcessorService {
  constructor(
    private readonly queueManager: QueueManagerService,
    private readonly commandExecutor: CommandExecutorService,
    private readonly containerManager: ContainerManagerService
  ) {}

  async processEmail(email: ParsedEmail) {
    const { clientId, projectId, userId } = this.extractIdentifiers(email);
    const chatThreadId = this.extractThreadId(email);
    const sessionId = chatThreadId; // Use thread ID as session ID
    
    // Get or create container queues (one set per user+project)
    const queues = await this.queueManager.getOrCreateContainerQueues(
      clientId,
      projectId,
      userId
    );
    
    // Ensure container is running
    await this.containerManager.ensureContainerRunning(
      clientId,
      projectId,
      userId,
      queues
    );
    
    // Send command to container's single queue
    const commandId = await this.commandExecutor.sendEditCommand(
      queues,
      sessionId,
      chatThreadId,
      email.instruction,
      email.from,
      { previousEmails: email.thread }
    );
    
    // Wait for response
    try {
      const response = await this.commandExecutor.waitForResponse(
        queues.outputUrl,
        commandId,
        60000 // 60 second timeout
      );
      
      // Send response email
      await this.sendResponseEmail(email.from, response);
    } catch (error) {
      if (error.message.includes('timeout')) {
        await this.sendTimeoutEmail(email.from, commandId);
      } else {
        throw error;
      }
    }
  }
}
```

## DynamoDB Table Structure

```typescript
// Table: webordinary-container-queues
{
  containerId: string,     // Partition key: {clientId}-{projectId}-{userId}
  inputUrl: string,
  outputUrl: string,
  dlqUrl: string,
  createdAt: number,
  lastActivity: number,
  ttl: number              // Auto-delete after 24 hours of inactivity
}
```

## Success Criteria
- [ ] Hermes creates one queue set per container (user+project)
- [ ] Commands sent to container's single input queue
- [ ] Multiple sessions can send to same queue
- [ ] Responses received and correlated correctly
- [ ] Queue URLs cached and persisted in DynamoDB
- [ ] Graceful handling of interrupts and timeouts

## Testing
- Test queue creation for new containers
- Test message send/receive flow
- Test multiple sessions using same queue
- Test interrupt notifications
- Test timeout handling
- Load test with rapid message sending to same queue