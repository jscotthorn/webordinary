# Container Routing Architecture Analysis

## Date: 2025-08-17

## The Critical Question
How do containers get assigned work from Step Functions?

## Current Implementation (What We Built)

### Step Functions Side
```json
"SendToContainer": {
  "Type": "Task",
  "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
  "Parameters": {
    "QueueUrl.$": "States.Format('https://sqs.{}.amazonaws.com/{}/webordinary-input-{}-{}.fifo', $.region, $.accountId, $.projectId, $.userId)",
    "MessageBody": { ... }
  }
}
```
- Sends DIRECTLY to project+user specific FIFO queue
- No claiming step
- No unclaimed queue

### Container Side
- Configured to poll a SPECIFIC queue on startup:
  ```typescript
  queueUrl: `webordinary-input-${PROJECT_ID}-${USER_ID}.fifo`
  ```
- Requires PROJECT_ID and USER_ID environment variables
- Container is essentially tied to one project+user combination

## Proposal's Original Design (Mixed Signals)

### References to Unclaimed Queue Pattern
1. **Line 40**: "Container polls UNCLAIMED_QUEUE_URL for new work"
2. **Line 117-119**: Smart routing - if unclaimed, send to both queues
3. **Lines 1734-1738**: CLAIM_REQUEST message handling in container
4. **rate-limited-claim-lambda**: Exists but not used in ASL

### But Also Direct Routing
- Step Functions ASL sends directly to project+user queues
- No ClaimContainer state in the ASL we built

## Three Possible Architectures

### Option 1: Container Per Project+User (Current Implementation)
```
Email → Step Functions → webordinary-input-amelia-scott.fifo → Container(amelia-scott)
```
**Pros:**
- Simple, direct routing
- No claiming complexity
- Clear ownership

**Cons:**
- Need container running for EVERY project+user combo
- Idle containers waste resources ($$$)
- Cold starts when user hasn't emailed recently

### Option 2: Generic Container Pool with Claiming
```
Email → Step Functions → Unclaimed Queue → Any Container → Claims → Polls project+user queue
```
**Pros:**
- Warm pool of containers
- Better resource utilization
- Containers can handle any project+user

**Cons:**
- Complex claiming logic
- Race conditions possible
- Additional DynamoDB operations

### Option 3: Dynamic Container Creation (Fargate Auto-Scaling)
```
Email → Step Functions → Queue → CloudWatch Alarm → ECS Auto-scaling → New Container
```
**Pros:**
- Zero idle cost
- Scales with demand
- Simple architecture

**Cons:**
- Cold start on every email (unless frequent)
- More complex ECS configuration
- Potentially slower response times

## Current Problems

### 1. Container Startup Configuration
Our container requires PROJECT_ID and USER_ID at startup:
```typescript
queueUrl: process.env.INPUT_QUEUE_URL || 
  `webordinary-input-${process.env.PROJECT_ID}-${process.env.USER_ID}.fifo`
```
This means containers are NOT generic - they're tied to one project+user.

### 2. No Claiming in Step Functions
The ASL doesn't call rate-limited-claim-lambda or send to unclaimed queue.

### 3. Scaling Issues
With current design:
- amelia+scott needs one container
- amelia+john needs another container
- project2+scott needs yet another container
- = N×M containers for N projects and M users!

## Recommendation: Hybrid Approach

### Short Term (Minimal Changes)
Keep current direct routing but add auto-scaling:
1. Step Functions sends to project+user queue ✓ (already done)
2. CloudWatch alarm on queue depth
3. ECS auto-scales containers with correct PROJECT_ID/USER_ID
4. Containers terminate after idle period

### Long Term (Better Architecture)
Implement true generic containers:
1. Remove PROJECT_ID/USER_ID from container startup
2. Add claiming mechanism:
   - Container polls unclaimed queue
   - Gets CLAIM_REQUEST with project+user+queueUrl
   - Claims via DynamoDB
   - Dynamically subscribes to that queue
3. Container can switch between projects/users
4. Warm pool of 2-3 containers handles all traffic

## Required Changes for Generic Containers

### Container Code Changes
```typescript
// Instead of fixed queue at startup
@SqsMessageHandler('unclaimed-queue', false)
async handleClaimRequest(message: Message) {
  const { projectId, userId, queueUrl } = JSON.parse(message.Body);
  
  // Dynamically subscribe to project+user queue
  await this.sqsService.registerQueue({
    name: `input-${projectId}-${userId}`,
    queueUrl: queueUrl,
    ...
  });
  
  // Start polling that queue
  this.startPolling(queueUrl);
}
```

### Step Functions Changes
Add choice state:
```json
"CheckIfClaimed": {
  "Type": "Task",
  "Resource": "arn:aws:states:::lambda:invoke",
  "Parameters": {
    "FunctionName": "check-container-ownership"
  },
  "Next": "RouteMessage"
},
"RouteMessage": {
  "Type": "Choice",
  "Choices": [{
    "Variable": "$.claimed",
    "BooleanEquals": true,
    "Next": "SendToContainer"
  }],
  "Default": "SendToUnclaimedQueue"
}
```

## Decision Required

**Question for User**: Which architecture do we want?

1. **Keep Current** (Container per project+user)
   - Simple but expensive at scale
   - Good for MVP with few users

2. **Implement Generic Containers** 
   - More complex but scalable
   - Better resource utilization
   - Requires refactoring

3. **Auto-scaling Specific Containers**
   - Middle ground
   - Containers still project+user specific
   - But only run when needed

The proposal seems to have intended Option 2 (generic containers with claiming) based on the unclaimed queue references, but we implemented Option 1 (specific containers).