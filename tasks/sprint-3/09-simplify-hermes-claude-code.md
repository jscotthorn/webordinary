# Task 09: Simplify Hermes to Router + Claude Code Executor

## Overview
Refactor Hermes from a LangChain-based agent system to a streamlined router that delegates actual work to Claude Code running in Fargate containers. This simplification reduces complexity, maintenance burden, and leverages Claude Code's superior capabilities for website modifications.

## Background
- Current Hermes uses LangChain/LangGraph for agent orchestration
- Sprint 1 successfully integrated Claude Code in containers
- Claude Code provides better context understanding and code generation
- Existing session management and routing infrastructure ready

## Requirements

### Core Refactoring Goals
1. **Remove LangChain Dependencies**
   - Eliminate LangGraph state machines
   - Remove LangChain tool definitions
   - Simplify to direct API calls
   - Reduce npm dependencies and container size

2. **Email-to-Claude Code Pipeline**
   - Parse incoming emails for instructions
   - Create/resume edit sessions
   - Forward instructions to Claude Code API
   - Return results via email

3. **Simplified Architecture**
   - Hermes as thin routing layer
   - Claude Code handles all AI decisions
   - Direct API communication
   - Stateless request handling

4. **Maintain Existing Features**
   - Session management via DynamoDB
   - Email processing via SQS/SES
   - Fargate container orchestration
   - Plan approval workflow (prepare for Task 12)

## Technical Implementation

### 1. New Hermes Architecture
```typescript
// Simplified app structure
hermes/
├── src/
│   ├── modules/
│   │   ├── email-processor/     # Parse and route emails
│   │   ├── claude-executor/     # Claude Code API client
│   │   ├── session-manager/     # Existing session logic
│   │   └── notification/        # Email responses
│   └── app.module.ts
```

### 2. Email Processor Module
```typescript
@Injectable()
export class EmailProcessorService {
  constructor(
    private readonly claudeExecutor: ClaudeExecutorService,
    private readonly sessionManager: SessionManagerService,
    private readonly notificationService: NotificationService,
  ) {}

  async processEmail(message: SQSMessage): Promise<void> {
    const email = this.parseEmail(message);
    
    // Extract instruction from email
    const instruction = this.extractInstruction(email);
    
    // Get or create session
    const session = await this.sessionManager.getOrCreateSession(
      email.from,
      email.threadId,
    );
    
    // Ensure container is running
    await this.sessionManager.ensureContainerRunning(session.sessionId);
    
    // Forward to Claude Code
    const result = await this.claudeExecutor.executeInstruction(
      session.sessionId,
      instruction,
    );
    
    // Send response
    await this.notificationService.sendResponse(
      email.from,
      result,
      email.threadId,
    );
  }
  
  private extractInstruction(email: ParsedEmail): string {
    // Simple extraction - let Claude Code handle complexity
    return email.textBody || email.htmlBody;
  }
}
```

### 3. Claude Code Executor
```typescript
@Injectable()
export class ClaudeExecutorService {
  private readonly baseUrl = process.env.ALB_URL;
  
  async executeInstruction(
    sessionId: string,
    instruction: string,
  ): Promise<ExecutionResult> {
    // Call Claude Code API in container
    const response = await fetch(
      `${this.baseUrl}/api/claude/${sessionId}/execute`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      },
    );
    
    const result = await response.json();
    
    // Handle different response types
    if (result.requiresApproval) {
      return this.createApprovalRequest(result);
    }
    
    return {
      success: result.success,
      message: result.summary,
      changes: result.changes,
      previewUrl: `${this.baseUrl}/session/${sessionId}/`,
    };
  }
  
  private createApprovalRequest(result: any): ExecutionResult {
    // Prepare for Task 12 approval UI
    return {
      success: true,
      requiresApproval: true,
      plan: result.plan,
      approvalToken: generateToken(),
      message: 'This change requires your approval.',
    };
  }
}
```

### 4. Container API Updates
```typescript
// In claude-code-container API
app.post('/api/claude/:sessionId/execute', async (req, res) => {
  const { sessionId } = req.params;
  const { instruction } = req.body;
  
  const thread = threadManager.getThread(sessionId);
  
  // Use Claude Code to process instruction
  const result = await claudeCode.execute({
    instruction,
    workingDirectory: thread.path,
    capabilities: ['read', 'write', 'git', 'terminal'],
  });
  
  // Auto-commit if changes made
  if (result.filesChanged.length > 0) {
    await thread.smartCommit(
      `Claude: ${instruction.substring(0, 50)}...`,
    );
  }
  
  res.json({
    success: true,
    summary: result.summary,
    changes: result.filesChanged,
    requiresApproval: result.requiresApproval,
    plan: result.plan,
  });
});
```

### 5. Removal List
```typescript
// Dependencies to remove
- "@langchain/core"
- "@langchain/community" 
- "@langchain/langgraph"
- "@langchain/aws"
- "langsmith"
- "zod" (if only used for LangChain)

// Modules to remove
- hermes/src/agent/
- hermes/src/tools/
- hermes/src/memory/
- hermes/src/checkpointer/
```

## Implementation Steps

### Phase 1: Dependency Analysis
1. Identify all LangChain usage points
2. Document required functionality to preserve
3. Plan migration path for each component
4. Create feature parity checklist

### Phase 2: Core Refactoring
1. Create new simplified module structure
2. Implement EmailProcessorService
3. Implement ClaudeExecutorService
4. Update session management for new flow

### Phase 3: Container API Extensions
1. Add `/api/claude/execute` endpoint
2. Integrate Claude Code SDK
3. Implement auto-commit functionality
4. Add approval detection logic

### Phase 4: Cleanup and Testing
1. Remove LangChain dependencies
2. Update Dockerfile for smaller image
3. Test email-to-preview flow
4. Verify session management works

## Benefits of Simplification

### Reduced Complexity
- **Before**: 15+ LangChain dependencies, complex state machines
- **After**: 5 core dependencies, simple request/response flow
- **Code reduction**: ~60% fewer lines of code

### Improved Maintainability
- Single responsibility for each service
- Clear data flow
- Easier debugging
- Simpler testing

### Better Performance
- Smaller container image (faster startup)
- Less memory usage
- Direct API calls (no LangChain overhead)
- Faster response times

### Enhanced Capabilities
- Leverage Claude Code's full feature set
- Better context understanding
- Superior code generation
- Native git integration

## Migration Strategy

### Data Migration
- Existing DynamoDB sessions remain compatible
- No changes to SQS message format
- Email templates stay the same

### Rollback Plan
1. Keep LangChain implementation in separate branch
2. Feature flag for old vs new processor
3. Gradual rollout with monitoring
4. Quick revert via environment variable

## Success Criteria

### Functional Requirements
- [ ] Email instructions processed successfully
- [ ] Claude Code executes in container
- [ ] Results returned via email
- [ ] Session management maintained
- [ ] Auto-commit working

### Non-Functional Requirements
- [ ] Container size reduced by >40%
- [ ] Response time improved by >30%
- [ ] Memory usage reduced by >50%
- [ ] Zero LangChain dependencies

### Testing Requirements
- [ ] Unit tests for new services
- [ ] Integration tests for email flow
- [ ] End-to-end preview generation
- [ ] Approval flow preparation

## Testing Plan

### Unit Testing
```bash
# Test new services
npm test email-processor.service.spec.ts
npm test claude-executor.service.spec.ts
```

### Integration Testing
```bash
# Test email processing
aws sqs send-message --queue-url $QUEUE_URL \
  --message-body '{"instruction": "Update homepage title"}'

# Verify container execution
curl -X POST $ALB_URL/api/claude/test-session/execute \
  -d '{"instruction": "Add a new blog post"}'
```

## Dependencies
- Claude Code container from Sprint 1
- Session management from Task 05
- ALB routing configured
- SQS/SES integration active

## Estimated Timeline
- Dependency Analysis: 2 hours
- Core Refactoring: 4 hours
- Container API Updates: 2 hours
- Testing & Cleanup: 2 hours
- **Total: 1.5 days**

## Future Enhancements
- Streaming responses for long operations
- Batch instruction processing
- Parallel execution for multiple files
- WebSocket for real-time updates

## Notes
- Coordinate with Task 12 for approval UI integration
- Keep approval detection logic extensible
- Document Claude Code API contract clearly
- Consider rate limiting for Claude API calls