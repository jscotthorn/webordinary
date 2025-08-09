# Task 10: SQS Infrastructure Setup with Per-Container Queues

## Objective
Set up AWS SQS infrastructure with one queue set per container (user+project combination) for simplified message handling between Hermes and edit containers.

## Requirements

### Queue Architecture
1. **Queue Naming Convention** (One set per container):
   - Input: `webordinary-input-{clientId}-{projectId}-{userId}`
   - Output: `webordinary-output-{clientId}-{projectId}-{userId}`
   - DLQ: `webordinary-dlq-{clientId}-{projectId}-{userId}`
   - Example: `webordinary-input-ameliastamps-website-john`

2. **Queue Configuration**:
   - Message retention: 4 days
   - Visibility timeout: 5 minutes
   - Max receive count: 3 (before DLQ)
   - Long polling: 20 seconds
   - Standard queues (not FIFO) for cost efficiency

3. **CDK Stack** (`hephaestus/lib/sqs-stack.ts`):
   - Queue creation on container startup
   - IAM policies for Fargate tasks
   - CloudWatch alarms for DLQ messages

## Simplified Architecture Benefits
- **One queue per container**: Direct 1:1 mapping
- **Automatic interrupts**: Any new message interrupts current work
- **No queue discovery**: Container knows its own queue
- **Simpler management**: Fewer queues to manage
- **Cost effective**: Fewer API calls

## Implementation

### CDK Stack
```typescript
// hephaestus/lib/sqs-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

export class SqsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Note: Queues are created dynamically when containers start
    // This stack provides the IAM policies and monitoring
    
    // IAM policy for Fargate tasks to manage their queues
    const queuePolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'sqs:CreateQueue',
            'sqs:DeleteQueue',
            'sqs:SendMessage',
            'sqs:ReceiveMessage',
            'sqs:DeleteMessage',
            'sqs:GetQueueAttributes',
            'sqs:SetQueueAttributes'
          ],
          resources: ['arn:aws:sqs:*:*:webordinary-*']
        })
      ]
    });
    
    // DLQ Alarm (monitors all DLQs with pattern matching)
    new cloudwatch.Alarm(this, 'DLQMessagesAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfMessagesVisible',
        dimensionsMap: { 
          QueueName: 'webordinary-dlq-*' 
        }
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Alert when messages appear in any DLQ'
    });
    
    // Export the policy ARN for use in Fargate task
    new cdk.CfnOutput(this, 'QueuePolicyArn', {
      value: queuePolicy.toString(),
      exportName: 'WebordinaryQueuePolicyArn'
    });
  }
}
```

### Queue Creation Service (Hermes)
```typescript
// hermes/src/modules/sqs/queue-manager.service.ts
import { Injectable } from '@nestjs/common';
import { SQSClient, CreateQueueCommand, DeleteQueueCommand } from '@aws-sdk/client-sqs';

@Injectable()
export class QueueManagerService {
  private readonly sqs: SQSClient;
  
  constructor() {
    this.sqs = new SQSClient({ region: 'us-west-2' });
  }
  
  async createContainerQueues(
    clientId: string,
    projectId: string,
    userId: string
  ): Promise<ContainerQueues> {
    const baseName = `${clientId}-${projectId}-${userId}`;
    
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
      dlqUrl: dlq.QueueUrl
    };
  }
  
  private async createQueue(queueName: string) {
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
  
  async deleteContainerQueues(
    clientId: string,
    projectId: string,
    userId: string
  ): Promise<void> {
    const baseName = `${clientId}-${projectId}-${userId}`;
    
    await Promise.all([
      this.deleteQueue(`webordinary-input-${baseName}`),
      this.deleteQueue(`webordinary-output-${baseName}`),
      this.deleteQueue(`webordinary-dlq-${baseName}`)
    ]);
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
      // Queue might not exist
      console.log(`Queue ${queueName} not found or already deleted`);
    }
  }
}
```

## Message Schema

```typescript
interface EditMessage {
  sessionId: string;        // Chat thread ID
  commandId: string;        // Unique command identifier
  timestamp: number;
  type: 'edit' | 'build' | 'commit' | 'push' | 'preview';
  instruction: string;
  userEmail: string;
  chatThreadId: string;     // For git branch switching
  context: {
    branch: string;         // Current git branch
    lastCommit?: string;
    filesModified?: string[];
  };
}

interface ResponseMessage {
  sessionId: string;
  commandId: string;
  timestamp: number;
  success: boolean;
  summary: string;
  filesChanged?: string[];
  error?: string;
  previewUrl?: string;
  interrupted?: boolean;    // True if interrupted by new message
}
```

## Container Startup

When a container starts, it receives its queue URLs via environment variables:
```bash
INPUT_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/xxx/webordinary-input-ameliastamps-website-john
OUTPUT_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/xxx/webordinary-output-ameliastamps-website-john
```

## Success Criteria
- [ ] One queue set created per container on startup
- [ ] Messages flow reliably between services
- [ ] DLQ captures failed messages
- [ ] CloudWatch shows queue metrics
- [ ] Queues deleted when container terminated

## Testing
- Test queue creation for new containers
- Verify message flow with interrupts
- Test DLQ routing for failures
- Load test with 10 concurrent containers