# Webordinary Architecture Recommendations: Container Orchestration & Communication Patterns

## Executive Summary

After reviewing the Webordinary infrastructure, I recommend transitioning from the current monolithic edit container to a **per-user-project container architecture** with **SQS-based event-driven communication**. Containers will be shared across multiple chat sessions for the same user+project combination, with interrupt handling for concurrent messages. This approach aligns with enterprise patterns while solving the current complexity issues around port mapping, service interactions, and container lifecycle management.

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

#### 1. One Container Per User+Project
- **Isolation**: Each user+project combination gets a dedicated container
- **Multi-Session Support**: Container handles multiple chat sessions for same project
- **Interrupt Handling**: New messages interrupt current processing gracefully
- **Session Queueing**: Process one session at a time, queue others

#### 2. SQS-Based Event Architecture
Replace HTTP API calls with asynchronous message passing:
- **Input Queue**: `webordinary-input-{clientId}-{projectId}-{userId}` - One per container
- **Output Queue**: `webordinary-output-{clientId}-{projectId}-{userId}` - One per container
- **DLQ**: `webordinary-dlq-{clientId}-{projectId}-{userId}` - For failed messages
- **Simple Mapping**: One queue set per container (1:1 relationship)
- **Benefits**: Decoupling, reliability, automatic interrupts, simpler architecture

#### 3. Container Responsibilities

**Edit Container (per user+project):**
- Astro dev server (port 4321) - serves preview traffic for all sessions
- SQS message handler - processes messages from single queue
- Claude Code executor - handles interrupts automatically
- Git operations - manages branches per chat thread
- NestJS with @ssut/nestjs-sqs for decorator-based handling

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
                    Edit Container (per user+project)
                    ├── Astro Dev Server (4321)
                    ├── Multi-Queue SQS Poller
                    ├── Claude Code Executor (with interrupt)
                    ├── Session Manager
                    └── Git Workspace (EFS)
                            ↓
                    ALB Routes Traffic
                    └── /session/{emailThreadId}/* → Container:4321
```

### Email Session Tracking

The system uses email thread IDs as the primary session identifier, ensuring natural conversation continuity:

- **Container ID**: `{clientId}-{projectId}-{userId}` (e.g., `ameliastamps-website-john`)
- **Queue Name**: `webordinary-input-{clientId}-{projectId}-{userId}`
- **Session ID**: `{chatThreadId}` (e.g., `thread-1a2b3c4d`)
- **Git Branch**: `thread-{chatThreadId}` for each conversation
- **Interrupt Behavior**: Any new message interrupts current processing

### Communication Flow

1. **Session Creation/Resumption**:
   - Hermes receives email with thread ID
   - Checks if session exists for `{clientId}-{emailThreadId}`
   - If exists and sleeping: wakes container
   - If new: creates session and starts container
   - Creates session-specific SQS queues if needed

2. **Command Processing**:
   - Hermes sends command to container's input queue
   - NestJS SQS handler receives message asynchronously
   - New message interrupts any current processing
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

**Multi-Session Edit Container:**
```typescript
// Main process: Astro dev server
npm run dev --host 0.0.0.0 --port 4321

// Using @ssut/nestjs-sqs for clean NestJS integration
import { SqsMessageHandler, SqsConsumerEventHandler } from '@ssut/nestjs-sqs';

@Injectable()
export class MessageProcessor {
  private currentProcess: ChildProcess | null = null;
  private currentSessionId: string | null = null;
  
  @SqsMessageHandler(process.env.QUEUE_NAME, false)
  async handleMessage(message: AWS.SQS.Message) {
    const body = JSON.parse(message.Body);
    
    // Any new message interrupts current work
    if (this.currentProcess) {
      await this.interruptCurrentProcess();
    }
    
    // Switch git branch if different session
    if (body.sessionId !== this.currentSessionId) {
      await this.switchToSession(body.sessionId);
    }
    
    // Process the new message
    this.currentSessionId = body.sessionId;
    this.currentProcess = await this.executeClaudeCode(body);
  }
  
  @SqsConsumerEventHandler('error')
  async onError(error: Error) {
    this.logger.error('SQS processing error', error);
  }
  
  async interruptCurrentProcess() {
    if (this.currentProcess) {
      this.currentProcess.kill('SIGINT');
      await this.savePartialProgress();
      this.currentProcess = null;
    }
  }
}
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
   - Clone repository for user+project
   - Install dependencies
   - Start Astro dev server
   - Start multi-queue SQS poller
   - Load existing chat thread branches

2. **Runtime**:
   - NestJS SQS handler processes messages from single queue
   - Automatically interrupts on new message arrival
   - Switches git branches based on session ID
   - Auto-commits changes before switching
   - Serves preview traffic for all sessions
   - Uses decorator-based message handling

3. **Shutdown**:
   - After idle timeout (20 min) with no messages
   - Push all uncommitted changes
   - Preserve session queues (deleted by Hermes)
   - Terminate container

## Implementation Timeline

### Sprint 4: Core Infrastructure & SQS Integration (Weeks 1-2)

**Week 1: Foundation**
- Task 10: SQS infrastructure setup with per-session queues
- Task 11: Container SQS polling alongside existing HTTP endpoints
- Task 12: Hermes email thread ID extraction and session mapping
- Task 13: Update Hermes to send messages via SQS (dual-mode)

**Week 2: Per-Session Architecture**
- Task 14: Per-session Fargate task management in CDK
- Task 15: Dynamic queue creation/deletion per email thread
- Task 16: Integration testing with both communication modes
- Task 17: CloudWatch monitoring and alerting setup

### Sprint 5: Migration & Production Hardening (Weeks 3-4)

**Week 1: Simplification**
- Task 18: Remove Express API server from container
- Task 19: Simplify container to Astro + SQS processor only
- Task 20: Update ALB routing for `/session/{emailThreadId}/*` pattern
- Task 21: Session resumption logic (wake sleeping containers)

**Week 2: Production Ready**
- Task 22: Error handling and retry logic with DLQs
- Task 23: Performance testing and optimization
- Task 24: Documentation and runbooks
- Task 25: Production deployment and gradual rollout

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

The recommended architecture of **one container per user+project with multi-session SQS-based communication** provides:
- Clean separation of concerns
- Enterprise-grade message handling
- Simplified container responsibilities
- Better security and isolation
- Maintained cost efficiency

This design eliminates the current "spaghetti" of port mappings and service interactions while providing a solid foundation for future features like collaborative editing, A/B testing, and multi-region deployment.

The migration can be done incrementally, reducing risk while improving the system progressively. The end result will be a more maintainable, scalable, and robust platform that follows AWS best practices and enterprise architectural patterns.