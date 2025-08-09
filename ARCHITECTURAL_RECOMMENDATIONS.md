# Webordinary Architecture Recommendations: Container Orchestration & Communication Patterns

## Executive Summary

After reviewing the Webordinary infrastructure, I recommend transitioning from the current monolithic edit container to a **per-session container architecture** with **SQS-based event-driven communication**. This approach aligns with enterprise patterns while solving the current complexity issues around port mapping, service interactions, and container lifecycle management.

## Current Architecture Assessment

### Pain Points
1. **Port Management Complexity**: The current single container manages multiple ports (8080 for API, 4321 for Astro, 4322 for WebSocket), creating ALB routing complexity
2. **Resource Contention**: Multiple users sharing one container leads to potential resource conflicts and security concerns
3. **State Management**: Thread-based isolation within a single container adds unnecessary complexity
4. **Service Coupling**: Express API server and Astro dev server are tightly coupled within the same container
5. **Scaling Limitations**: Cannot scale individual editing sessions independently

### Strengths to Preserve
- EFS-based persistent workspace storage
- Git branch-based isolation for user changes
- Claude Code integration for AI-powered editing
- Cost-effective scale-to-zero architecture

## Recommended Architecture

### Core Design Principles

#### 1. One Container Per Edit Session
- **Isolation**: Each user gets a dedicated container with their own Astro dev server
- **Security**: Complete process isolation between different users/clients
- **Resource Management**: Containers can be sized based on individual project needs
- **Simplified State**: No need for complex thread management within containers

#### 2. SQS-Based Event Architecture
Replace HTTP API calls with asynchronous message passing:
- **Input Queue**: `webordinary-edit-requests-{sessionId}` - Commands from Hermes
- **Output Queue**: `webordinary-edit-responses-{sessionId}` - Results back to Hermes
- **Benefits**: Decoupling, reliability, natural queuing of requests

#### 3. Container Responsibilities

**Edit Container (per session):**
- Astro dev server (port 4321) - serves preview traffic directly
- SQS message processor - handles edit commands
- Claude Code executor - performs AI operations
- Git operations - manages code changes

**Hermes Service (singleton):**
- Session orchestration - creates/manages edit sessions
- Email processing - converts emails to edit commands
- SQS message routing - sends commands to appropriate session queues
- Fargate lifecycle management - scales containers up/down

### Implementation Architecture

```
User Email → SES → SQS → Hermes Service
                            ↓
                    Extract Email Thread ID
                            ↓
                    Session ID = {clientId}-{emailThreadId}
                            ↓
                    Creates/Resumes Edit Session
                            ↓
                    Starts/Wakes Fargate Task
                            ↓
                    Edit Container (per email thread)
                    ├── Astro Dev Server (4321)
                    ├── SQS Poller (NestJS)
                    ├── Claude Code Executor
                    └── Git Workspace (EFS)
                            ↓
                    ALB Routes Traffic
                    └── /session/{emailThreadId}/* → Container:4321
```

### Email Session Tracking

The system uses email thread IDs as the primary session identifier, ensuring natural conversation continuity:

- **Session ID Format**: `{clientId}-{emailThreadId}` (e.g., `ameliastamps-1a2b3c4d`)
- **Git Branch**: `email-{threadId}` for clear association
- **Session Persistence**: Sessions persist across multiple emails in the same thread
- **Auto-Resume**: Sleeping containers wake when new emails arrive in thread

### Communication Flow

1. **Session Creation/Resumption**:
   - Hermes receives email with thread ID
   - Checks if session exists for `{clientId}-{emailThreadId}`
   - If exists and sleeping: wakes container
   - If new: creates session and starts container
   - Creates session-specific SQS queues if needed

2. **Command Processing**:
   - Hermes sends command to thread-specific input queue
   - Edit container polls queue
   - Executes Claude Code operations with thread context
   - Sends results to output queue
   - Hermes receives response and emails user

3. **Preview Access**:
   - ALB routes `/session/{emailThreadId}/*` to container
   - Users can share preview URLs that persist for email thread
   - Astro dev server handles all preview traffic
   - WebSocket/HMR works naturally without proxy

## Technical Implementation Details

### Container Structure

**Simplified Edit Container:**
```typescript
// Main process: Astro dev server
npm run dev --host 0.0.0.0 --port 4321

// Background service: SQS processor (NestJS microservice)
@Module({
  imports: [
    SqsModule.register({
      consumers: [{
        queueUrl: process.env.INPUT_QUEUE_URL,
        handleMessage: async (message) => {
          const result = await claudeExecutor.execute(message.Body);
          await sqsClient.sendMessage({
            QueueUrl: process.env.OUTPUT_QUEUE_URL,
            MessageBody: JSON.stringify(result)
          });
        }
      }]
    })
  ]
})
```

### Queue Design

**Message Schema:**
```json
{
  "sessionId": "uuid",
  "commandId": "uuid",
  "type": "edit|build|commit|push",
  "instruction": "user instruction text",
  "context": {
    "branch": "thread-xyz",
    "files": ["src/pages/index.astro"]
  }
}
```

### Container Lifecycle

1. **Startup**: 
   - Clone repository
   - Checkout session branch
   - Install dependencies
   - Start Astro dev server
   - Start SQS poller

2. **Runtime**:
   - Process SQS messages
   - Execute Claude operations
   - Auto-commit changes
   - Serve preview traffic

3. **Shutdown**:
   - After idle timeout (20 min)
   - Push uncommitted changes
   - Delete SQS queues
   - Terminate container

## Migration Path

### Phase 1: Decouple Services (Week 1)
- Separate Astro server from Express API in current container
- Implement SQS message handler alongside existing HTTP endpoints
- Test queue-based communication with Hermes

### Phase 2: Per-Session Containers (Week 2)
- Modify CDK to create per-session task definitions
- Implement session-based queue creation
- Update ALB routing for session paths

### Phase 3: Remove Legacy Code (Week 3)
- Remove Express API server
- Simplify container to just Astro + SQS processor
- Clean up port mapping complexity

## Benefits of Recommended Approach

### Operational Excellence
- **Simpler Debugging**: Each session has isolated logs and metrics
- **Clear Boundaries**: One container = one user session
- **Better Observability**: CloudWatch metrics per session

### Security
- **Complete Isolation**: No shared process space between users
- **IAM Boundaries**: Per-session IAM roles possible
- **Audit Trail**: SQS provides message history

### Reliability
- **Message Durability**: SQS ensures no lost commands
- **Retry Logic**: Built-in dead letter queues for failed operations
- **Graceful Degradation**: Queue backpressure prevents overload

### Performance
- **Independent Scaling**: Size containers based on project needs
- **No Port Conflicts**: Each container owns its ports
- **Direct Routing**: ALB sends traffic straight to Astro

### Cost Optimization
- **Maintained Scale-to-Zero**: Containers still shut down when idle
- **SQS Pricing**: $0.40 per million messages (negligible)
- **Right-Sized Containers**: Can use smaller containers for simple sites

## Considerations & Trade-offs

### Potential Challenges
1. **Cold Start Time**: Starting new container takes 30-60 seconds
2. **Queue Management**: Need to clean up abandoned queues
3. **Complexity**: More moving parts than current monolith

### Mitigations
1. **Pre-warming**: Start container when email received, not after processing
2. **TTL on Queues**: Auto-delete after session expires
3. **Monitoring**: CloudWatch dashboards for queue depth and container health

## Alternative Considered: Lambda + Step Functions

While Lambda could handle command processing, the long-running nature of Astro dev server and need for persistent file system make Fargate the better choice. Step Functions could orchestrate workflows but add unnecessary complexity for this use case.

## Conclusion

The recommended architecture of **one container per session with SQS-based communication** provides:
- Clean separation of concerns
- Enterprise-grade message handling
- Simplified container responsibilities
- Better security and isolation
- Maintained cost efficiency

This design eliminates the current "spaghetti" of port mappings and service interactions while providing a solid foundation for future features like collaborative editing, A/B testing, and multi-region deployment.

The migration can be done incrementally, reducing risk while improving the system progressively. The end result will be a more maintainable, scalable, and robust platform that follows AWS best practices and enterprise architectural patterns.