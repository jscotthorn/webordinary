# Task 22: Error Handling and Retry Logic with DLQs

## Objective
Implement comprehensive error handling and retry logic using Dead Letter Queues (DLQs) to ensure reliable message processing and proper failure recovery.

## Error Categories

### 1. Transient Errors (Retry)
- Network timeouts
- Container starting
- Git conflicts
- Temporary resource unavailability

### 2. Permanent Errors (DLQ)
- Invalid message format
- Authentication failures
- Repository not found
- Syntax errors in instructions

### 3. Critical Errors (Alert)
- Container crashes
- Out of memory
- Disk full
- Security violations

## Implementation

### Message Retry Configuration

```typescript
// hermes/src/modules/sqs/retry-config.ts
export const RETRY_CONFIG = {
  input: {
    maxReceiveCount: 3,
    visibilityTimeout: 300, // 5 minutes
    backoffMultiplier: 2,
    maxBackoff: 900 // 15 minutes
  },
  output: {
    maxReceiveCount: 5,
    visibilityTimeout: 60,
    backoffMultiplier: 1.5,
    maxBackoff: 300
  }
};

export class RetryManager {
  async configureQueue(queueUrl: string, dlqArn: string, config: RetryConfig) {
    const redrivePolicy = {
      deadLetterTargetArn: dlqArn,
      maxReceiveCount: config.maxReceiveCount
    };
    
    await this.sqs.send(new SetQueueAttributesCommand({
      QueueUrl: queueUrl,
      Attributes: {
        RedrivePolicy: JSON.stringify(redrivePolicy),
        VisibilityTimeout: config.visibilityTimeout.toString(),
        MessageRetentionPeriod: '345600' // 4 days
      }
    }));
  }
  
  calculateBackoff(attemptNumber: number, config: RetryConfig): number {
    const backoff = Math.min(
      config.visibilityTimeout * Math.pow(config.backoffMultiplier, attemptNumber - 1),
      config.maxBackoff
    );
    return Math.floor(backoff);
  }
}
```

### Error Classification and Handling

```typescript
// claude-code-container/src/error-handler.ts
export enum ErrorType {
  TRANSIENT = 'transient',
  PERMANENT = 'permanent',
  CRITICAL = 'critical'
}

export class ErrorHandler {
  classifyError(error: Error): ErrorType {
    const message = error.message.toLowerCase();
    
    // Transient errors - should retry
    if (
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('rate limit') ||
      message.includes('temporarily unavailable') ||
      message.includes('container starting') ||
      message.includes('git conflict')
    ) {
      return ErrorType.TRANSIENT;
    }
    
    // Permanent errors - send to DLQ
    if (
      message.includes('invalid') ||
      message.includes('malformed') ||
      message.includes('not found') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('syntax error')
    ) {
      return ErrorType.PERMANENT;
    }
    
    // Critical errors - alert immediately
    if (
      message.includes('out of memory') ||
      message.includes('disk full') ||
      message.includes('segmentation fault') ||
      message.includes('security violation')
    ) {
      return ErrorType.CRITICAL;
    }
    
    // Default to transient
    return ErrorType.TRANSIENT;
  }
  
  async handleError(
    error: Error,
    message: any,
    context: ProcessingContext
  ): Promise<ErrorResponse> {
    const errorType = this.classifyError(error);
    const attemptNumber = this.getAttemptNumber(message);
    
    console.error(`Error processing message (attempt ${attemptNumber}):`, {
      errorType,
      error: error.message,
      sessionId: message.sessionId,
      commandId: message.commandId
    });
    
    switch (errorType) {
      case ErrorType.TRANSIENT:
        return this.handleTransientError(error, message, attemptNumber, context);
        
      case ErrorType.PERMANENT:
        return this.handlePermanentError(error, message, context);
        
      case ErrorType.CRITICAL:
        return this.handleCriticalError(error, message, context);
    }
  }
  
  private async handleTransientError(
    error: Error,
    message: any,
    attemptNumber: number,
    context: ProcessingContext
  ): Promise<ErrorResponse> {
    if (attemptNumber >= RETRY_CONFIG.input.maxReceiveCount) {
      // Max retries exceeded, send to DLQ
      console.error('Max retries exceeded, sending to DLQ');
      return this.sendToDLQ(message, error, context);
    }
    
    // Calculate backoff
    const backoff = this.retryManager.calculateBackoff(
      attemptNumber,
      RETRY_CONFIG.input
    );
    
    // Return error response with retry indication
    return {
      success: false,
      error: error.message,
      errorType: ErrorType.TRANSIENT,
      shouldRetry: true,
      retryAfter: backoff,
      attemptNumber
    };
  }
  
  private async handlePermanentError(
    error: Error,
    message: any,
    context: ProcessingContext
  ): Promise<ErrorResponse> {
    // Send directly to DLQ
    await this.sendToDLQ(message, error, context);
    
    // Notify user of permanent failure
    await this.notifyUserOfFailure(message, error);
    
    return {
      success: false,
      error: error.message,
      errorType: ErrorType.PERMANENT,
      shouldRetry: false
    };
  }
  
  private async handleCriticalError(
    error: Error,
    message: any,
    context: ProcessingContext
  ): Promise<ErrorResponse> {
    // Send alert immediately
    await this.sendCriticalAlert(error, message, context);
    
    // Send to DLQ
    await this.sendToDLQ(message, error, context);
    
    // Attempt graceful shutdown if necessary
    if (this.shouldShutdown(error)) {
      await this.initiateGracefulShutdown();
    }
    
    return {
      success: false,
      error: error.message,
      errorType: ErrorType.CRITICAL,
      shouldRetry: false
    };
  }
  
  private getAttemptNumber(message: any): number {
    return parseInt(
      message.Attributes?.ApproximateReceiveCount || '1'
    );
  }
}
```

### DLQ Processing Lambda

```typescript
// hephaestus/lambdas/dlq-processor/index.ts
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const sns = new SNSClient({ region: 'us-west-2' });
const dynamodb = new DynamoDBClient({ region: 'us-west-2' });

export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    await processDLQMessage(record);
  }
};

async function processDLQMessage(record: SQSRecord) {
  const message = JSON.parse(record.body);
  const metadata = {
    messageId: record.messageId,
    receiptHandle: record.receiptHandle,
    sentTimestamp: record.attributes.SentTimestamp,
    receiveCount: record.attributes.ApproximateReceiveCount,
    dlqTimestamp: Date.now()
  };
  
  // Store in DynamoDB for analysis
  await dynamodb.send(new PutItemCommand({
    TableName: 'webordinary-dlq-messages',
    Item: {
      messageId: { S: metadata.messageId },
      sessionId: { S: message.sessionId || 'unknown' },
      commandId: { S: message.commandId || 'unknown' },
      errorType: { S: message.errorType || 'unknown' },
      errorMessage: { S: message.error || 'No error message' },
      originalMessage: { S: JSON.stringify(message) },
      metadata: { S: JSON.stringify(metadata) },
      timestamp: { N: metadata.dlqTimestamp.toString() },
      ttl: { N: (metadata.dlqTimestamp / 1000 + 30 * 24 * 60 * 60).toString() } // 30 days
    }
  }));
  
  // Analyze error patterns
  const analysis = await analyzeError(message);
  
  // Send alert if necessary
  if (analysis.shouldAlert) {
    await sendAlert(message, analysis);
  }
  
  // Attempt auto-recovery if possible
  if (analysis.canRecover) {
    await attemptRecovery(message, analysis);
  }
}

async function analyzeError(message: any): Promise<ErrorAnalysis> {
  const error = message.error?.toLowerCase() || '';
  
  return {
    shouldAlert: error.includes('critical') || error.includes('security'),
    canRecover: error.includes('git conflict') || error.includes('timeout'),
    category: categorizeError(error),
    suggestedAction: getSuggestedAction(error)
  };
}

async function sendAlert(message: any, analysis: ErrorAnalysis) {
  const alert = {
    Subject: `DLQ Alert: ${analysis.category}`,
    Message: `
      Session: ${message.sessionId}
      Command: ${message.commandId}
      Error: ${message.error}
      Suggested Action: ${analysis.suggestedAction}
      
      Full Message: ${JSON.stringify(message, null, 2)}
    `,
    TopicArn: process.env.ALERT_TOPIC_ARN
  };
  
  await sns.send(new PublishCommand(alert));
}

async function attemptRecovery(message: any, analysis: ErrorAnalysis) {
  switch (analysis.category) {
    case 'git_conflict':
      // Reset branch and retry
      await resetGitBranch(message.sessionId);
      await requeueMessage(message);
      break;
      
    case 'container_died':
      // Restart container and retry
      await restartContainer(message.sessionId);
      await requeueMessage(message);
      break;
      
    case 'timeout':
      // Increase timeout and retry
      await requeueWithLongerTimeout(message);
      break;
  }
}
```

### Circuit Breaker Pattern

```typescript
// hermes/src/modules/circuit-breaker/circuit-breaker.ts
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private readonly threshold = 5,
    private readonly timeout = 60000, // 1 minute
    private readonly resetTimeout = 300000 // 5 minutes
  ) {}
  
  async execute<T>(
    fn: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'half-open';
      } else if (fallback) {
        return fallback();
      } else {
        throw new Error('Circuit breaker is open');
      }
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess() {
    if (this.state === 'half-open') {
      this.state = 'closed';
    }
    this.failures = 0;
  }
  
  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'open';
      console.error(`Circuit breaker opened after ${this.failures} failures`);
    }
  }
}
```

### Monitoring and Metrics

```typescript
// CloudWatch metrics for error tracking
export class ErrorMetrics {
  async recordError(
    errorType: ErrorType,
    sessionId: string,
    error: string
  ) {
    await this.cloudWatch.send(new PutMetricDataCommand({
      Namespace: 'Webordinary/Errors',
      MetricData: [{
        MetricName: `${errorType}Errors`,
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'SessionId', Value: sessionId },
          { Name: 'ErrorType', Value: errorType }
        ],
        Timestamp: new Date()
      }]
    }));
  }
  
  async recordDLQMessage(queueName: string) {
    await this.cloudWatch.send(new PutMetricDataCommand({
      Namespace: 'Webordinary/DLQ',
      MetricData: [{
        MetricName: 'MessagesReceived',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'QueueName', Value: queueName }
        ],
        Timestamp: new Date()
      }]
    }));
  }
}
```

## Success Criteria
- [ ] Transient errors retry with backoff
- [ ] Permanent errors go to DLQ immediately
- [ ] Critical errors trigger alerts
- [ ] DLQ messages are analyzed and stored
- [ ] Circuit breaker prevents cascading failures
- [ ] Metrics track error rates

## Testing
- Test retry logic with simulated failures
- Verify DLQ routing for permanent errors
- Test critical error alerts
- Verify circuit breaker operation
- Monitor error metrics under load
- Test auto-recovery mechanisms