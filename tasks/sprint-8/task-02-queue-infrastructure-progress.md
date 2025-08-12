# Sprint 8 Task 2: Queue Infrastructure Implementation

## Summary of Changes

### 1. Queue Structure Implemented
**Pattern:** `webordinary-{type}-{projectId}-{userId}`

#### Created Queues
- `webordinary-input-ameliastamps-scott` ✅
- `webordinary-output-ameliastamps-scott` ✅  
- `webordinary-dlq-ameliastamps-scott` ✅
- `webordinary-unclaimed` (via CDK) 🚀 Deploying

### 2. Message Routing Service
Created `MessageRouterService` in Hermes with three-section logic:

#### Section 1: Identify Project+User
```typescript
// Priority order:
1. SessionId lookup → DynamoDB
2. ThreadId lookup → DynamoDB  
3. Email lookup → Hardcoded config (escottster@gmail.com → ameliastamps/scott)
```

#### Section 2: Route to Project Queue
- Sends message to `webordinary-input-{projectId}-{userId}`
- Enriches message with projectId and userId

#### Section 3: Container Assignment Check
- Checks `webordinary-container-ownership` table
- If no active container, sends claim request to unclaimed queue

### 3. CDK Infrastructure Updates

#### SqsStack Additions
- **Unclaimed Queue**: For idle containers to monitor
- **Container Ownership Table**: Tracks which container owns which project+user
  - Partition Key: `projectKey` (format: `projectId#userId`)
  - GSI: `containerId-index` for reverse lookup
  - TTL support for auto-expiring inactive containers

### 4. SQS Executor Service
Created `SqsExecutorService` to replace HTTP-based communication:
- Sends messages to project input queues
- Polls output queues for responses
- Handles timeouts and container startup scenarios

## Architecture Flow

```
Email Arrives
    ↓
Hermes Identifies Project+User
    ↓
Routes to Project Queue (ameliastamps-scott)
    ↓
Checks Container Ownership
    ↓
If No Container → Send to Unclaimed Queue
    ↓
Container Claims Work → Updates Ownership Table
    ↓
Container Processes Messages from Project Queue
    ↓
Container Sends Responses to Output Queue
    ↓
Hermes Receives Response → Sends Email Reply
```

## Key Design Decisions

1. **Project-Based Queues**: Each project+user gets dedicated queues (provisioned at onboarding)
2. **Unclaimed Queue**: Central queue for container pool management
3. **Ownership Tracking**: DynamoDB table prevents multiple containers claiming same project
4. **Email Mapping**: Hardcoded for MVP, will move to DynamoDB later
5. **Terminology**: Using `projectId` (e.g., ameliastamps) not `clientId`

## Current Status

### ✅ Completed
- Created project-specific queues for ameliastamps/scott
- Implemented MessageRouterService
- Created SqsExecutorService
- Updated CDK with unclaimed queue and ownership table
- Updated email processor to use new routing
- **Created QueueManagerService** for container claim mechanism
- **Updated container main.ts** to use QueueManagerService
- **Modified app.module.ts** to include QueueManagerService
- **Updated Fargate stack** with UNCLAIMED_QUEUE_URL and OWNERSHIP_TABLE_NAME
- **Added DynamoDB permissions** for container ownership table

### 🚧 In Progress
- Building and pushing new container image
- Deploying infrastructure updates

### 📋 TODO
- Build new container image with claim mechanism
- Deploy updated Fargate and SQS stacks
- Test complete email → container → S3 flow
- Move email-to-project mapping to DynamoDB

## Testing Notes

The system should now:
1. Route emails from escottster@gmail.com to ameliastamps/scott queues
2. Check for active containers
3. Send to unclaimed queue if no container assigned
4. Wait for container to claim and process

## Detailed Implementation Plan for Remaining Work

### 1. Container Claim Mechanism Implementation

#### A. Update Container Environment Variables (Fargate Stack)
```typescript
// In /hephaestus/lib/fargate-stack.ts, add to container environment:
environment: {
  UNCLAIMED_QUEUE_URL: 'https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed',
  OWNERSHIP_TABLE_NAME: 'webordinary-container-ownership',
  // Remove fixed CLIENT_ID and USER_ID - will be dynamic
}
```

#### B. Container Startup Logic 
Create `/claude-code-container/src/services/queue-manager.service.ts`:
```typescript
class QueueManagerService {
  private currentProjectKey: string | null = null;
  private inputQueueUrl: string | null = null;
  private outputQueueUrl: string | null = null;
  private containerId: string = generateContainerId();
  
  async initialize() {
    // Start by polling unclaimed queue
    this.pollUnclaimedQueue();
  }
  
  async pollUnclaimedQueue() {
    while (!this.currentProjectKey) {
      const message = await sqs.receiveMessage({
        QueueUrl: process.env.UNCLAIMED_QUEUE_URL,
        WaitTimeSeconds: 20,
      });
      
      if (message.Messages?.[0]) {
        const claim = JSON.parse(message.Messages[0].Body);
        if (claim.type === 'claim_request') {
          await this.claimProject(claim.projectId, claim.userId);
        }
      }
    }
  }
  
  async claimProject(projectId: string, userId: string) {
    const projectKey = `${projectId}#${userId}`;
    
    // Try to claim ownership atomically
    try {
      await dynamodb.putItem({
        TableName: process.env.OWNERSHIP_TABLE_NAME,
        Item: {
          projectKey: { S: projectKey },
          containerId: { S: this.containerId },
          claimedAt: { N: Date.now().toString() },
          lastActivity: { N: Date.now().toString() },
          status: { S: 'active' },
          ttl: { N: (Date.now() / 1000 + 3600).toString() }, // 1 hour TTL
        },
        ConditionExpression: 'attribute_not_exists(projectKey)',
      });
      
      // Successfully claimed!
      this.currentProjectKey = projectKey;
      this.inputQueueUrl = `https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-input-${projectId}-${userId}`;
      this.outputQueueUrl = `https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-output-${projectId}-${userId}`;
      
      // Update git config for this project
      await this.gitService.setProjectContext(projectId, userId);
      
      // Start polling project queue
      this.pollProjectQueue();
      
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Another container already owns this project
        console.log(`Project ${projectKey} already claimed`);
      }
    }
  }
  
  async pollProjectQueue() {
    while (this.currentProjectKey) {
      const message = await sqs.receiveMessage({
        QueueUrl: this.inputQueueUrl,
        WaitTimeSeconds: 20,
      });
      
      if (message.Messages?.[0]) {
        await this.processMessage(message.Messages[0]);
        
        // Update last activity
        await this.updateActivity();
      }
      
      // Check if we should release ownership (idle too long)
      if (await this.shouldRelease()) {
        await this.releaseOwnership();
        this.pollUnclaimedQueue(); // Go back to unclaimed
      }
    }
  }
  
  async updateActivity() {
    await dynamodb.updateItem({
      TableName: process.env.OWNERSHIP_TABLE_NAME,
      Key: { projectKey: { S: this.currentProjectKey } },
      UpdateExpression: 'SET lastActivity = :now, #ttl = :ttl',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':now': { N: Date.now().toString() },
        ':ttl': { N: (Date.now() / 1000 + 3600).toString() },
      },
    });
  }
}
```

#### C. Update Container Main Entry Point
```typescript
// In /claude-code-container/src/main.ts or bootstrap
async function startContainer() {
  const queueManager = new QueueManagerService();
  const messageProcessor = new MessageProcessorService();
  
  // Initialize services
  await queueManager.initialize();
  
  // Queue manager will handle claiming and message routing
  queueManager.on('message', async (message) => {
    const result = await messageProcessor.process(message);
    await queueManager.sendResponse(result);
  });
}
```

### 2. Update Hermes to Use New Services

#### A. Update Email Processor Module
```typescript
// In /hermes/src/modules/email-processor/email-processor.module.ts
import { MessageRouterService } from '../message-processor/message-router.service';
import { SqsExecutorService } from '../claude-executor/sqs-executor.service';

@Module({
  providers: [
    EmailProcessorService,
    MessageRouterService,  // Add new router
    SqsExecutorService,    // Add SQS executor
    // Remove or deprecate ClaudeExecutorService
  ],
})
```

#### B. Update Email Processor to Use SQS Executor
```typescript
// In email-processor.service.ts
constructor(
  private readonly sqsExecutor: SqsExecutorService,
  private readonly messageRouter: MessageRouterService,
) {}

async processEmail(message: any) {
  // ... existing email parsing ...
  
  // Use SQS executor instead of HTTP
  const result = await this.sqsExecutor.executeInstruction(
    session.sessionId,
    instruction,
    email.from,
    email.threadId,
  );
}
```

### 3. Testing Plan

#### A. Manual Testing Steps
1. **Verify Infrastructure**:
   ```bash
   # Check queues exist
   AWS_PROFILE=personal aws sqs list-queues --queue-name-prefix webordinary
   
   # Check tables exist
   AWS_PROFILE=personal aws dynamodb list-tables | grep webordinary
   ```

2. **Send Test Email**:
   - Send email to SES from escottster@gmail.com
   - Monitor Hermes logs for routing decision
   - Check if message appears in ameliastamps-scott queue

3. **Monitor Container Claiming**:
   ```bash
   # Watch unclaimed queue
   AWS_PROFILE=personal aws sqs get-queue-attributes \
     --queue-url https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed \
     --attribute-names ApproximateNumberOfMessages
   
   # Check ownership table
   AWS_PROFILE=personal aws dynamodb scan \
     --table-name webordinary-container-ownership
   ```

4. **Verify S3 Deployment**:
   ```bash
   # Check S3 bucket for updates
   AWS_PROFILE=personal aws s3 ls s3://edit.ameliastamps.webordinary.com/ --recursive
   ```

#### B. Integration Test Suite
```typescript
// /tests/integration/scenarios/queue-routing.test.ts
describe('Queue-based message routing', () => {
  it('should route email to correct project queue', async () => {
    // Send email
    await ses.sendEmail({
      From: 'escottster@gmail.com',
      To: 'edit@webordinary.com',
      Subject: 'Test',
      Body: 'Update homepage title',
    });
    
    // Wait and check ameliastamps-scott queue
    const messages = await pollQueue('webordinary-input-ameliastamps-scott');
    expect(messages).toHaveLength(1);
    expect(messages[0].projectId).toBe('ameliastamps');
  });
  
  it('should send to unclaimed when no container active', async () => {
    // Ensure no container owns ameliastamps-scott
    await clearOwnership('ameliastamps#scott');
    
    // Send message
    await sendTestMessage();
    
    // Check unclaimed queue
    const unclaimed = await pollQueue('webordinary-unclaimed');
    expect(unclaimed).toHaveLength(1);
  });
});
```

### 4. Production Readiness Tasks

#### A. Move Email Mapping to DynamoDB
```typescript
// Create project-config table
const projectConfigTable = new dynamodb.Table('ProjectConfigTable', {
  tableName: 'webordinary-project-configs',
  partitionKey: { name: 'email', type: STRING },
  attributes: {
    projectId: STRING,
    userId: STRING,
    defaultInstruction: STRING,
  }
});

// Update MessageRouterService to query this table
async getProjectFromEmail(email: string) {
  const result = await dynamodb.getItem({
    TableName: 'webordinary-project-configs',
    Key: { email: { S: email } }
  });
  return result.Item;
}
```

#### B. Add Monitoring
- CloudWatch alarms for queue depth
- Container ownership metrics
- Message processing latency
- Failed claim attempts

#### C. Onboarding Process Documentation
1. Create project queues (input, output, DLQ)
2. Add email → project mapping to config table
3. Set IAM permissions for project S3 bucket
4. Configure git repository access
5. Test with sample email

### 5. Error Handling Improvements

#### A. Container Failure Recovery
- If container crashes while owning project, TTL will auto-release
- Unclaimed queue will get new claim request
- Another container can claim the work

#### B. Message Retry Logic
- Use SQS visibility timeout for retry
- Move to DLQ after max attempts
- Alert on DLQ messages

#### C. Ownership Conflicts
- Use DynamoDB conditional writes to prevent races
- Log all claim attempts for debugging
- Implement backoff for failed claims

## Timeline Estimate

1. **Container Claim Mechanism**: 2-3 hours
   - Update container code
   - Test claim logic
   - Deploy new container image

2. **Hermes Integration**: 1-2 hours
   - Wire up new services
   - Test SQS executor
   - Deploy Hermes update

3. **End-to-End Testing**: 2-3 hours
   - Manual testing
   - Debug issues
   - Write integration tests

4. **Production Prep**: 2-3 hours
   - Move config to DynamoDB
   - Add monitoring
   - Document process

**Total**: 8-11 hours of implementation work