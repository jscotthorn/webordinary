# Task 24: Documentation and Runbooks

## Objective
Create comprehensive documentation and operational runbooks for the new multi-session SQS architecture to ensure smooth operations and maintenance.

## Documentation Components

### 1. Architecture Documentation

```markdown
# Webordinary Edit Session Architecture

## Overview
The Webordinary platform uses a multi-session, queue-based architecture where:
- Each user+project combination gets a dedicated Fargate container
- Multiple chat sessions can share the same container
- Communication happens via SQS queues (one pair per chat session)
- Containers scale to zero when idle for cost optimization

## Key Components

### Containers
- **Identity**: `{clientId}-{projectId}-{userId}`
- **Purpose**: Runs Astro dev server and processes edit commands
- **Lifecycle**: Start on demand, sleep after 20 minutes idle

### Queues
- **Input Queue**: Receives commands from Hermes
- **Output Queue**: Sends responses back to Hermes
- **DLQ**: Captures failed messages for analysis

### Sessions
- **Identity**: `{chatThreadId}`
- **Mapping**: Multiple sessions → One container
- **Persistence**: Git branches per chat thread

## Data Flow
1. User sends message (email/SMS/chat)
2. Hermes extracts thread ID and creates/resumes session
3. Message sent to session's input queue
4. Container processes message (with interrupt handling)
5. Response sent to output queue
6. Hermes sends response to user

## Scaling Behavior
- Containers start when first session created
- Additional sessions reuse existing container
- Container sleeps after all sessions idle
- Automatic wake on new messages
```

### 2. Operational Runbooks

#### Container Management Runbook

```markdown
# Container Management Runbook

## Starting a Container Manually

### When to Use
- Container failed to start automatically
- Testing new container image
- Debugging container issues

### Steps
1. Identify the container ID:
   ```bash
   CONTAINER_ID="${CLIENT_ID}-${PROJECT_ID}-${USER_ID}"
   ```

2. Start Fargate task:
   ```bash
   aws ecs run-task \
     --cluster webordinary-edit-cluster \
     --task-definition webordinary-edit-task \
     --launch-type FARGATE \
     --network-configuration "awsvpcConfiguration={
       subnets=[subnet-xxx,subnet-yyy],
       securityGroups=[sg-xxx],
       assignPublicIp=ENABLED
     }" \
     --overrides "{
       \"containerOverrides\": [{
         \"name\": \"edit-container\",
         \"environment\": [
           {\"name\": \"CONTAINER_ID\", \"value\": \"${CONTAINER_ID}\"},
           {\"name\": \"CLIENT_ID\", \"value\": \"${CLIENT_ID}\"},
           {\"name\": \"PROJECT_ID\", \"value\": \"${PROJECT_ID}\"},
           {\"name\": \"USER_ID\", \"value\": \"${USER_ID}\"}
         ]
       }]
     }"
   ```

3. Verify container started:
   ```bash
   aws ecs list-tasks --cluster webordinary-edit-cluster
   aws ecs describe-tasks --cluster webordinary-edit-cluster --tasks <task-arn>
   ```

4. Update DynamoDB:
   ```bash
   aws dynamodb put-item \
     --table-name webordinary-containers \
     --item "{
       \"containerId\": {\"S\": \"${CONTAINER_ID}\"},
       \"taskArn\": {\"S\": \"<task-arn>\"},
       \"status\": {\"S\": \"running\"}
     }"
   ```

## Stopping a Container

### When to Use
- Container is misbehaving
- Need to force restart
- Maintenance window

### Steps
1. Find the task ARN:
   ```bash
   aws dynamodb get-item \
     --table-name webordinary-containers \
     --key "{\"containerId\": {\"S\": \"${CONTAINER_ID}\"}}"
   ```

2. Stop the task:
   ```bash
   aws ecs stop-task \
     --cluster webordinary-edit-cluster \
     --task <task-arn> \
     --reason "Manual stop for maintenance"
   ```

3. Update status:
   ```bash
   aws dynamodb update-item \
     --table-name webordinary-containers \
     --key "{\"containerId\": {\"S\": \"${CONTAINER_ID}\"}}" \
     --update-expression "SET #status = :status" \
     --expression-attribute-names "{\"#status\": \"status\"}" \
     --expression-attribute-values "{\":status\": {\"S\": \"stopped\"}}"
   ```
```

#### Queue Management Runbook

```markdown
# Queue Management Runbook

## Viewing Queue Messages

### Check queue depth:
```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-west-2.amazonaws.com/xxx/webordinary-input-${SESSION_ID} \
  --attribute-names ApproximateNumberOfMessages
```

### Read messages (without deleting):
```bash
aws sqs receive-message \
  --queue-url https://sqs.us-west-2.amazonaws.com/xxx/webordinary-input-${SESSION_ID} \
  --max-number-of-messages 10 \
  --visibility-timeout 0
```

## Handling DLQ Messages

### List DLQ messages:
```bash
aws sqs receive-message \
  --queue-url https://sqs.us-west-2.amazonaws.com/xxx/webordinary-dlq-${SESSION_ID} \
  --max-number-of-messages 10
```

### Reprocess DLQ message:
```bash
# 1. Read message from DLQ
MESSAGE=$(aws sqs receive-message --queue-url ${DLQ_URL} --max-number-of-messages 1)

# 2. Send to input queue
aws sqs send-message \
  --queue-url ${INPUT_QUEUE_URL} \
  --message-body "$(echo $MESSAGE | jq -r '.Messages[0].Body')"

# 3. Delete from DLQ
aws sqs delete-message \
  --queue-url ${DLQ_URL} \
  --receipt-handle "$(echo $MESSAGE | jq -r '.Messages[0].ReceiptHandle')"
```

## Purging Queues

### When to Use
- Testing environment reset
- Clearing stuck messages
- Emergency recovery

### Steps:
```bash
aws sqs purge-queue --queue-url ${QUEUE_URL}
```
```

#### Incident Response Runbook

```markdown
# Incident Response Runbook

## High DLQ Message Count

### Symptoms
- CloudWatch alarm for DLQ messages
- Users reporting failed operations

### Investigation
1. Check DLQ contents:
   ```bash
   ./scripts/check-dlq.sh ${SESSION_ID}
   ```

2. Analyze error patterns:
   ```sql
   SELECT errorType, COUNT(*) as count
   FROM webordinary_dlq_messages
   WHERE timestamp > now() - interval '1 hour'
   GROUP BY errorType
   ORDER BY count DESC;
   ```

3. Check container logs:
   ```bash
   aws logs tail /ecs/webordinary/edit --follow --filter-pattern ERROR
   ```

### Resolution
- **Transient errors**: Reprocess messages from DLQ
- **Permanent errors**: Fix root cause, then reprocess
- **Critical errors**: Page on-call, may need container restart

## Container Out of Memory

### Symptoms
- Container crashes with exit code 137
- CloudWatch memory metric > 90%

### Investigation
1. Check memory usage:
   ```bash
   aws ecs describe-tasks --cluster webordinary-edit-cluster --tasks ${TASK_ARN}
   ```

2. Review recent commands:
   ```bash
   aws dynamodb query \
     --table-name webordinary-edit-sessions \
     --index-name container-index \
     --key-condition-expression "containerId = :cid" \
     --expression-attribute-values "{\":cid\": {\"S\": \"${CONTAINER_ID}\"}}"
   ```

### Resolution
1. Increase container memory:
   ```bash
   # Update task definition with more memory
   aws ecs register-task-definition --family webordinary-edit-task --memory 2048
   ```

2. Restart container with new definition

3. Investigate memory leak if recurring

## Session Stuck in Processing

### Symptoms
- User reports no response
- Message in queue but not processed

### Investigation
1. Check message visibility:
   ```bash
   aws sqs get-queue-attributes \
     --queue-url ${INPUT_QUEUE_URL} \
     --attribute-names ApproximateNumberOfMessagesNotVisible
   ```

2. Check container status:
   ```bash
   ./scripts/check-container.sh ${CONTAINER_ID}
   ```

3. Check for interrupts:
   ```bash
   aws logs tail /ecs/webordinary/edit --filter-pattern "Interrupting session"
   ```

### Resolution
1. If container dead: Restart container
2. If message invisible: Wait for visibility timeout
3. If truly stuck: Delete message and notify user
```

### 3. Developer Guide

```markdown
# Developer Guide

## Local Development Setup

### Prerequisites
- Docker Desktop
- AWS CLI configured
- Node.js 18+

### Running Locally
1. Clone repository:
   ```bash
   git clone https://github.com/webordinary/edit-container
   ```

2. Set environment variables:
   ```bash
   export CONTAINER_ID="local-test-container"
   export WORKSPACE_PATH="./workspace"
   export AWS_REGION="us-west-2"
   ```

3. Run container:
   ```bash
   docker-compose up
   ```

## Adding New Features

### Message Types
To add a new message type:

1. Update message schema:
   ```typescript
   // types/messages.ts
   export interface CustomMessage extends BaseMessage {
     type: 'custom';
     customField: string;
   }
   ```

2. Add handler:
   ```typescript
   // handlers/custom.handler.ts
   export class CustomHandler implements MessageHandler {
     async handle(message: CustomMessage): Promise<Response> {
       // Implementation
     }
   }
   ```

3. Register handler:
   ```typescript
   // index.ts
   handlers.set('custom', new CustomHandler());
   ```

## Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
npm run test:integration
```

### Load Tests
```bash
npm run test:load
```

## Deployment

### Building Container
```bash
./scripts/build.sh
```

### Pushing to ECR
```bash
./scripts/push-to-ecr.sh
```

### Deploying CDK
```bash
cd hephaestus
npx cdk deploy --all
```
```

### 4. Monitoring Guide

```markdown
# Monitoring Guide

## Key Metrics to Watch

### Container Metrics
- **CPU Usage**: Should stay below 70%
- **Memory Usage**: Should stay below 80%
- **Task Count**: Number of running containers
- **Startup Time**: Time to healthy status

### Queue Metrics
- **Queue Depth**: Messages waiting to process
- **Message Age**: Oldest message in queue
- **DLQ Count**: Failed messages (should be 0)
- **Processing Rate**: Messages per minute

### Session Metrics
- **Active Sessions**: Current session count
- **Session Duration**: Average session length
- **Interrupt Rate**: Session switches per hour
- **Error Rate**: Failed commands percentage

## CloudWatch Dashboards

### Main Dashboard
- Widget 1: Queue depth across all queues
- Widget 2: Container count and status
- Widget 3: Error rate by type
- Widget 4: Response time percentiles

### Detailed Dashboard
- Widget 1: Individual queue metrics
- Widget 2: Container resource usage
- Widget 3: Session lifecycle events
- Widget 4: DLQ message details

## Alerts

### Critical (Page immediately)
- DLQ messages > 0
- Container crash loop
- All containers down
- Queue processing stopped

### Warning (Notify team)
- High queue depth (> 50)
- Memory usage > 80%
- Error rate > 5%
- Slow response times

### Info (Log only)
- Container scaling events
- Session creation/deletion
- Routine errors
```

## Success Criteria
- [ ] Architecture documentation complete
- [ ] All runbooks tested and validated
- [ ] Developer guide covers common tasks
- [ ] Monitoring guide includes all metrics
- [ ] Documentation in Git repository

## Documentation Standards
- Use Markdown format
- Include code examples
- Provide troubleshooting steps
- Keep updated with changes
- Review quarterly