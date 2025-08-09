# Task 15: Container Queue Management and Lifecycle

## Objective
Implement queue lifecycle management for the single queue set per container (user+project), including creation, monitoring, and cleanup.

## Requirements

### Queue Lifecycle
1. **Queue Creation**:
   - Create one queue set per container (user+project)
   - Name pattern: `webordinary-{input|output|dlq}-{clientId}-{projectId}-{userId}`
   - Queue URLs passed to container via environment variables
   - Queues created when container starts

2. **Queue Persistence**:
   - Store queue URLs in DynamoDB for container restart scenarios
   - Cache queue URLs in Hermes for performance
   - TTL on DynamoDB records for automatic cleanup

3. **Queue Cleanup**:
   - Delete queues when container terminates
   - Handle orphaned queues from crashed containers
   - Implement scheduled cleanup Lambda

## Implementation

### Queue Lifecycle Manager

```typescript
// hermes/src/modules/sqs/queue-lifecycle.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SQSClient, DeleteQueueCommand, GetQueueAttributesCommand, ListQueuesCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

@Injectable()
export class QueueLifecycleService {
  private readonly logger = new Logger(QueueLifecycleService.name);
  private readonly sqs: SQSClient;
  private readonly dynamodb: DynamoDBDocumentClient;

  constructor() {
    this.sqs = new SQSClient({ region: 'us-west-2' });
    const ddbClient = new DynamoDBClient({ region: 'us-west-2' });
    this.dynamodb = DynamoDBDocumentClient.from(ddbClient);
  }

  async cleanupContainerQueues(
    clientId: string,
    projectId: string,
    userId: string
  ): Promise<void> {
    const containerId = `${clientId}-${projectId}-${userId}`;
    
    this.logger.log(`Cleaning up queues for container: ${containerId}`);
    
    // Delete queues
    const baseName = `${clientId}-${projectId}-${userId}`;
    await Promise.all([
      this.deleteQueueSafely(`webordinary-input-${baseName}`),
      this.deleteQueueSafely(`webordinary-output-${baseName}`),
      this.deleteQueueSafely(`webordinary-dlq-${baseName}`)
    ]);
    
    // Remove from DynamoDB
    await this.dynamodb.send(new DeleteCommand({
      TableName: 'webordinary-container-queues',
      Key: { containerId }
    }));
    
    this.logger.log(`Cleanup complete for container: ${containerId}`);
  }

  private async deleteQueueSafely(queueName: string): Promise<void> {
    try {
      const urlResult = await this.sqs.send(new GetQueueUrlCommand({
        QueueName: queueName
      }));
      
      // Check if queue is empty before deleting (optional)
      const attrs = await this.sqs.send(new GetQueueAttributesCommand({
        QueueUrl: urlResult.QueueUrl,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
      }));
      
      const messagesInQueue = 
        parseInt(attrs.Attributes?.ApproximateNumberOfMessages || '0') +
        parseInt(attrs.Attributes?.ApproximateNumberOfMessagesNotVisible || '0');
      
      if (messagesInQueue > 0) {
        this.logger.warn(`Queue ${queueName} has ${messagesInQueue} messages, deleting anyway`);
      }
      
      await this.sqs.send(new DeleteQueueCommand({
        QueueUrl: urlResult.QueueUrl
      }));
      
      this.logger.debug(`Deleted queue: ${queueName}`);
    } catch (error) {
      if (error.name === 'QueueDoesNotExist') {
        this.logger.debug(`Queue ${queueName} does not exist, skipping deletion`);
      } else {
        this.logger.error(`Failed to delete queue ${queueName}:`, error);
        throw error;
      }
    }
  }

  async findOrphanedQueues(): Promise<string[]> {
    const orphanedQueues: string[] = [];
    
    // List all Webordinary queues
    const listResult = await this.sqs.send(new ListQueuesCommand({
      QueueNamePrefix: 'webordinary-'
    }));
    
    if (!listResult.QueueUrls) return orphanedQueues;
    
    // Get all active containers from DynamoDB
    const scanResult = await this.dynamodb.send(new ScanCommand({
      TableName: 'webordinary-container-queues',
      ProjectionExpression: 'containerId'
    }));
    
    const activeContainers = new Set(
      (scanResult.Items || []).map(item => item.containerId)
    );
    
    // Check each queue
    for (const queueUrl of listResult.QueueUrls) {
      const queueName = queueUrl.split('/').pop();
      
      // Extract container ID from queue name
      const match = queueName?.match(/webordinary-(?:input|output|dlq)-(.+)$/);
      if (match) {
        const containerId = match[1];
        
        if (!activeContainers.has(containerId)) {
          // Check queue age before marking as orphaned
          const attrs = await this.sqs.send(new GetQueueAttributesCommand({
            QueueUrl: queueUrl,
            AttributeNames: ['CreatedTimestamp']
          }));
          
          const createdAt = parseInt(attrs.Attributes?.CreatedTimestamp || '0') * 1000;
          const ageHours = (Date.now() - createdAt) / (1000 * 60 * 60);
          
          if (ageHours > 24) {
            orphanedQueues.push(queueUrl);
            this.logger.warn(`Found orphaned queue (${ageHours.toFixed(1)}h old): ${queueName}`);
          }
        }
      }
    }
    
    return orphanedQueues;
  }

  async cleanupOrphanedQueues(): Promise<number> {
    const orphanedQueues = await this.findOrphanedQueues();
    
    for (const queueUrl of orphanedQueues) {
      try {
        await this.sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
        this.logger.info(`Deleted orphaned queue: ${queueUrl}`);
      } catch (error) {
        this.logger.error(`Failed to delete orphaned queue ${queueUrl}:`, error);
      }
    }
    
    return orphanedQueues.length;
  }
}
```

### Container Lifecycle Integration

```typescript
// hermes/src/modules/container/container-manager.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ECSClient, RunTaskCommand, StopTaskCommand } from '@aws-sdk/client-ecs';
import { QueueManagerService } from '../sqs/queue-manager.service';
import { QueueLifecycleService } from '../sqs/queue-lifecycle.service';

@Injectable()
export class ContainerManagerService {
  private readonly logger = new Logger(ContainerManagerService.name);
  private readonly ecs: ECSClient;

  constructor(
    private readonly queueManager: QueueManagerService,
    private readonly queueLifecycle: QueueLifecycleService
  ) {
    this.ecs = new ECSClient({ region: 'us-west-2' });
  }

  async startContainer(
    clientId: string,
    projectId: string,
    userId: string
  ): Promise<string> {
    // Get or create queues for this container
    const queues = await this.queueManager.getOrCreateContainerQueues(
      clientId,
      projectId,
      userId
    );
    
    // Start Fargate task with queue URLs as environment variables
    const taskResult = await this.ecs.send(new RunTaskCommand({
      cluster: 'webordinary-edit-cluster',
      taskDefinition: 'webordinary-edit-task',
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: ['subnet-xxx', 'subnet-yyy'],
          securityGroups: ['sg-xxx'],
          assignPublicIp: 'ENABLED'
        }
      },
      overrides: {
        containerOverrides: [{
          name: 'edit-container',
          environment: [
            { name: 'INPUT_QUEUE_URL', value: queues.inputUrl },
            { name: 'OUTPUT_QUEUE_URL', value: queues.outputUrl },
            { name: 'CLIENT_ID', value: clientId },
            { name: 'PROJECT_ID', value: projectId },
            { name: 'USER_ID', value: userId },
            { name: 'WORKSPACE_PATH', value: `/efs/${clientId}/${projectId}` }
          ]
        }]
      },
      tags: [
        { key: 'ClientId', value: clientId },
        { key: 'ProjectId', value: projectId },
        { key: 'UserId', value: userId },
        { key: 'ContainerId', value: `${clientId}-${projectId}-${userId}` }
      ]
    }));
    
    const taskArn = taskResult.tasks?.[0]?.taskArn;
    this.logger.log(`Started container ${clientId}-${projectId}-${userId} with task ${taskArn}`);
    
    return taskArn;
  }

  async stopContainer(
    clientId: string,
    projectId: string,
    userId: string,
    taskArn: string
  ): Promise<void> {
    // Stop the Fargate task
    await this.ecs.send(new StopTaskCommand({
      cluster: 'webordinary-edit-cluster',
      task: taskArn,
      reason: 'User requested termination'
    }));
    
    // Clean up queues
    await this.queueLifecycle.cleanupContainerQueues(
      clientId,
      projectId,
      userId
    );
    
    this.logger.log(`Stopped container ${clientId}-${projectId}-${userId}`);
  }

  async handleContainerTermination(event: any): Promise<void> {
    // Called by EventBridge when a container stops
    const containerId = event.detail.tags?.ContainerId;
    
    if (containerId) {
      const [clientId, projectId, userId] = containerId.split('-');
      
      await this.queueLifecycle.cleanupContainerQueues(
        clientId,
        projectId,
        userId
      );
    }
  }
}
```

### Cleanup Lambda Function

```typescript
// hephaestus/lambdas/queue-cleanup/index.ts
import { ScheduledEvent } from 'aws-lambda';
import { SQSClient, DeleteQueueCommand, ListQueuesCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

export const handler = async (event: ScheduledEvent): Promise<void> => {
  const sqs = new SQSClient({ region: 'us-west-2' });
  const ddbClient = new DynamoDBClient({ region: 'us-west-2' });
  const dynamodb = DynamoDBDocumentClient.from(ddbClient);
  
  console.log('Starting queue cleanup process...');
  
  // Find stale container records (>24 hours without activity)
  const staleContainers = await dynamodb.send(new ScanCommand({
    TableName: 'webordinary-container-queues',
    FilterExpression: 'createdAt < :cutoff',
    ExpressionAttributeValues: {
      ':cutoff': Date.now() - (24 * 60 * 60 * 1000) // 24 hours
    }
  }));
  
  // Clean up stale containers and their queues
  for (const container of staleContainers.Items || []) {
    console.log(`Cleaning up stale container: ${container.containerId}`);
    
    try {
      // Delete queues
      await Promise.all([
        deleteQueueIfExists(sqs, `webordinary-input-${container.containerId}`),
        deleteQueueIfExists(sqs, `webordinary-output-${container.containerId}`),
        deleteQueueIfExists(sqs, `webordinary-dlq-${container.containerId}`)
      ]);
      
      // Delete DynamoDB record
      await dynamodb.send(new DeleteCommand({
        TableName: 'webordinary-container-queues',
        Key: { containerId: container.containerId }
      }));
      
      console.log(`Cleaned up container: ${container.containerId}`);
    } catch (error) {
      console.error(`Failed to cleanup container ${container.containerId}:`, error);
    }
  }
  
  // Find orphaned queues (queues without DynamoDB records)
  const allQueues = await sqs.send(new ListQueuesCommand({
    QueueNamePrefix: 'webordinary-'
  }));
  
  const activeContainers = await dynamodb.send(new ScanCommand({
    TableName: 'webordinary-container-queues',
    ProjectionExpression: 'containerId'
  }));
  
  const activeContainerIds = new Set(
    (activeContainers.Items || []).map(item => item.containerId)
  );
  
  for (const queueUrl of allQueues.QueueUrls || []) {
    const queueName = queueUrl.split('/').pop();
    const match = queueName?.match(/webordinary-(?:input|output|dlq)-(.+)$/);
    
    if (match) {
      const containerId = match[1];
      
      if (!activeContainerIds.has(containerId)) {
        // Check queue age
        const attrs = await sqs.send(new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ['CreatedTimestamp']
        }));
        
        const createdAt = parseInt(attrs.Attributes?.CreatedTimestamp || '0') * 1000;
        const ageHours = (Date.now() - createdAt) / (1000 * 60 * 60);
        
        if (ageHours > 24) {
          console.log(`Deleting orphaned queue (${ageHours.toFixed(1)}h old): ${queueName}`);
          await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
        }
      }
    }
  }
  
  console.log('Queue cleanup process complete');
};

async function deleteQueueIfExists(sqs: SQSClient, queueName: string): Promise<void> {
  try {
    const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
    await sqs.send(new DeleteQueueCommand({ QueueUrl }));
  } catch (error) {
    if (error.name !== 'QueueDoesNotExist') {
      throw error;
    }
  }
}
```

### CDK Configuration for Cleanup Lambda

```typescript
// hephaestus/lib/cleanup-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';

export class CleanupStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Lambda function for queue cleanup
    const cleanupFunction = new lambda.Function(this, 'QueueCleanupFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/queue-cleanup'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: {
        REGION: 'us-west-2'
      }
    });
    
    // Grant permissions
    cleanupFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'sqs:ListQueues',
        'sqs:DeleteQueue',
        'sqs:GetQueueAttributes',
        'sqs:GetQueueUrl',
        'dynamodb:Scan',
        'dynamodb:DeleteItem'
      ],
      resources: ['*']
    }));
    
    // Schedule rule - run every 6 hours
    const rule = new events.Rule(this, 'QueueCleanupSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.hours(6)),
      description: 'Trigger queue cleanup every 6 hours'
    });
    
    rule.addTarget(new targets.LambdaFunction(cleanupFunction));
  }
}
```

## Success Criteria
- [ ] Queues created with container startup
- [ ] Queue URLs stored in DynamoDB with TTL
- [ ] Container receives queue URLs via environment
- [ ] Queues deleted on container termination
- [ ] Orphaned queues cleaned up by Lambda
- [ ] CloudWatch metrics track queue lifecycle

## Testing
- Test queue creation on container start
- Verify queue deletion on container stop
- Test orphaned queue detection and cleanup
- Verify DynamoDB TTL works correctly
- Test Lambda cleanup function
- Monitor CloudWatch for queue metrics