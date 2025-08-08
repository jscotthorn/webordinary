# Task 3: Replace LangGraph Planner with Claude Code Plan Mode

## Overview
Migrate from the complex LangGraph state machine implementation to Claude Code SDK's built-in planning and execution capabilities, significantly simplifying the Hermes architecture while maintaining all functionality.

## Business Requirements
- Maintain current email-based workflow
- Preserve human-in-the-loop for destructive operations
- Keep conversation threading and state persistence
- Reduce complexity and maintenance burden
- Improve response time and reliability

## Current State Analysis

### Existing LangGraph Implementation
- **Complex State Machine**: 8 nodes with conditional routing
- **State Management**: SQLite checkpointing with Annotation-based state
- **Planning**: Custom JSON plan generation with Bedrock/Claude
- **Execution**: Step-by-step tool execution with error handling
- **Human-in-the-Loop**: Interrupt-based workflow pausing

### Problems with Current Approach
1. **Over-engineered**: 500+ lines of code for plan/execute pattern
2. **Fragile**: JSON parsing errors, state synchronization issues
3. **Limited**: Mock CMS tools don't actually modify files
4. **Slow**: Multiple LLM calls for planning and execution
5. **Complex Dependencies**: LangChain, LangGraph, multiple adapters

## Target Architecture with Claude Code SDK

### Simplified Flow
```typescript
Email → Parse → Claude Code (plan/execute) → Git Commit → Response
```

### Key Advantages
1. **Built-in Planning**: Claude Code handles plan generation natively
2. **Real File Operations**: Direct git and file system access
3. **Streaming Support**: Real-time progress updates
4. **Simpler State**: No complex annotation system needed
5. **Fewer Dependencies**: Just Claude Code SDK + minimal helpers

## Technical Implementation

### 1. New Service Structure

```typescript
// src/modules/message-pipeline/services/claude-agent.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaudeCode } from '@anthropic/claude-code-sdk';
import { ParsedMail } from 'mailparser';
import { SESService } from '../services/ses.service';

@Injectable()
export class ClaudeAgentService {
  private claude: ClaudeCode;
  private sessionStore: Map<string, any> = new Map();

  constructor(
    private configService: ConfigService,
    private sesService: SESService
  ) {
    this.claude = new ClaudeCode({
      apiKey: this.configService.get('anthropic.apiKey'),
      model: 'claude-3-opus-20240229',
      maxTokens: 8192,
    });
  }

  async processEmail(email: ParsedMail): Promise<void> {
    const threadId = this.extractThreadId(email);
    const session = this.sessionStore.get(threadId) || {};
    
    try {
      // Determine if this needs planning or direct execution
      const mode = this.determineMode(email.text);
      
      if (mode === 'plan') {
        const plan = await this.generatePlan(email.text, session);
        await this.requestApproval(email, plan, threadId);
      } else {
        const result = await this.executeDirectly(email.text, session);
        await this.sendCompletionEmail(email, result);
      }
    } catch (error) {
      await this.sendErrorEmail(email, error);
    }
  }

  private async generatePlan(instruction: string, context: any) {
    return await this.claude.plan({
      instruction,
      workingDirectory: '/workspace/amelia-astro',
      context: {
        previousActions: context.history || [],
        gitBranch: context.branch || 'main',
      }
    });
  }

  private async executeDirectly(instruction: string, context: any) {
    return await this.claude.execute({
      instruction,
      workingDirectory: '/workspace/amelia-astro',
      tools: ['file_edit', 'git_commit', 'astro_preview'],
      streaming: true,
      onProgress: (update) => console.log('Progress:', update),
    });
  }

  private determineMode(text: string): 'plan' | 'execute' {
    // Simple heuristic - can be enhanced with ML classifier
    const complexKeywords = ['redesign', 'refactor', 'delete', 'remove', 'multiple'];
    const needsPlan = complexKeywords.some(keyword => 
      text.toLowerCase().includes(keyword)
    );
    return needsPlan ? 'plan' : 'execute';
  }

  private extractThreadId(email: ParsedMail): string {
    // Extract from email headers or generate new
    return email.messageId || `thread-${Date.now()}`;
  }

  private async requestApproval(email: ParsedMail, plan: any, threadId: string) {
    const approvalUrl = `https://edit.ameliastamps.com/approve/${threadId}`;
    const rejectUrl = `https://edit.ameliastamps.com/reject/${threadId}`;
    
    const htmlContent = `
      <h2>Plan for your request:</h2>
      <pre>${JSON.stringify(plan, null, 2)}</pre>
      <p>
        <a href="${approvalUrl}" style="background: green; color: white; padding: 10px;">Approve</a>
        <a href="${rejectUrl}" style="background: red; color: white; padding: 10px;">Reject</a>
      </p>
    `;
    
    await this.sesService.sendEmail({
      to: email.from?.text,
      subject: `Re: ${email.subject} - Approval Required`,
      html: htmlContent,
    });
    
    // Store plan for later execution
    this.sessionStore.set(threadId, { plan, email, status: 'pending' });
  }
}
```

### 2. Simplified State Management with EFS Persistence

```typescript
// src/modules/message-pipeline/types/session.interface.ts
export interface Session {
  clientId: string;
  userId: string;
  threadId: string;
  email: ParsedMail;
  plan?: any;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  history: Array<{
    timestamp: Date;
    action: string;
    result: any;
  }>;
  branch?: string; // Git branch for this thread
  workspacePath?: string; // User workspace path
}

// Session store that integrates with EFS persistence
export class SessionStore {
  private memoryCache = new Map<string, Session>();
  
  async get(clientId: string, userId: string, threadId: string): Promise<Session | null> {
    const key = `${clientId}/${userId}/${threadId}`;
    
    // Check memory cache first
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key)!;
    }
    
    // Check EFS for persisted session
    const efsPath = `/workspace/${clientId}/${userId}/.claude/threads/${threadId}.json`;
    if (await this.fileExists(efsPath)) {
      const session = JSON.parse(await fs.readFile(efsPath, 'utf-8'));
      this.memoryCache.set(key, session);
      return session;
    }
    
    return null;
  }
  
  async set(clientId: string, userId: string, threadId: string, session: Session): Promise<void> {
    const key = `${clientId}/${userId}/${threadId}`;
    
    // Update memory cache
    this.memoryCache.set(key, session);
    
    // Persist to EFS
    const efsPath = `/workspace/${clientId}/${userId}/.claude/threads/${threadId}.json`;
    await fs.mkdir(path.dirname(efsPath), { recursive: true });
    await fs.writeFile(efsPath, JSON.stringify(session, null, 2));
  }
  
  async resume(clientId: string, userId: string, threadId: string): Promise<boolean> {
    const session = await this.get(clientId, userId, threadId);
    return session !== null && session.status !== 'completed';
  }
  
  async listUserThreads(clientId: string, userId: string): Promise<string[]> {
    const threadsDir = `/workspace/${clientId}/${userId}/.claude/threads/`;
    if (await this.fileExists(threadsDir)) {
      const files = await fs.readdir(threadsDir);
      return files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
    }
    return [];
  }
}
```

### 3. Migration Steps

#### Phase 1: Parallel Implementation (Days 1-2)
1. Create new `ClaudeAgentService` alongside existing `AgentService`
2. Implement basic email processing with Claude Code SDK
3. Add feature flag to toggle between implementations
4. Set up session store for state management

#### Phase 2: Feature Parity (Days 3-4)
1. Implement plan generation and approval flow
2. Add direct execution for simple requests
3. Integrate with existing SES email service
4. Add error handling and retry logic

#### Phase 3: Testing & Validation (Day 5)
1. Create test suite comparing old vs new implementation
2. Validate with real email scenarios
3. Performance testing and optimization
4. Document behavior differences

### 4. Code Changes Required

#### Remove Dependencies
```json
// package.json - Remove these
{
  "@langchain/community": "^0.3.17",
  "@langchain/core": "^0.3.26",
  "@langchain/langgraph": "^0.2.39",
  "@langchain/langgraph-checkpoint-sqlite": "^0.0.10"
}
```

#### Add Claude Code SDK
```json
// package.json - Add
{
  "@anthropic/claude-code-sdk": "^1.0.0"
}
```

#### Update Module Imports
```typescript
// src/modules/message-pipeline/message-pipeline.module.ts
import { Module } from '@nestjs/common';
import { ClaudeAgentService } from './services/claude-agent.service';
import { SESService } from './services/ses.service';
import { MessagePipelineController } from './controllers/message-pipeline.controller';

@Module({
  providers: [
    ClaudeAgentService,  // New service
    SESService,
  ],
  controllers: [MessagePipelineController],
  exports: [ClaudeAgentService],
})
export class MessagePipelineModule {}
```

### 5. Configuration Updates

```typescript
// src/core/config/configuration.ts
export default () => ({
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-3-opus-20240229',
  },
  claudeCode: {
    workingDirectory: process.env.WORKSPACE_PATH || '/workspace/amelia-astro',
    maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
    timeout: parseInt(process.env.EXECUTION_TIMEOUT || '30000'),
  },
  featureFlags: {
    useClaudeCode: process.env.USE_CLAUDE_CODE === 'true',
  },
});
```

## Acceptance Criteria

1. ✅ Email processing works with Claude Code SDK
2. ✅ Plan generation for complex requests
3. ✅ Direct execution for simple requests
4. ✅ Human approval flow maintained
5. ✅ Thread continuity preserved with EFS persistence
6. ✅ Sessions resume from EFS on container restart
7. ✅ All existing email scenarios handled
8. ✅ Performance improved (< 5s for simple requests)
9. ✅ Code complexity reduced by > 50%
10. ✅ All tests passing
11. ✅ Feature flag allows rollback
12. ✅ Build cache and node_modules preserved between sessions

## Testing Plan

### Unit Tests
```typescript
describe('ClaudeAgentService', () => {
  it('should generate plan for complex requests');
  it('should execute directly for simple requests');
  it('should handle approval flow');
  it('should maintain thread context');
  it('should handle errors gracefully');
});
```

### Integration Tests
1. End-to-end email processing
2. Plan approval and execution
3. Thread continuation
4. Error scenarios
5. Performance benchmarks

### A/B Testing
- Run both implementations in parallel
- Compare results for consistency
- Measure performance differences
- Collect error rates

## Rollback Plan

1. Feature flag `USE_CLAUDE_CODE=false` reverts to LangGraph
2. Keep LangGraph code for 2 sprints before removal
3. Maintain SQLite checkpoints during transition
4. Document any behavioral differences

## Dependencies

- EFS filesystem configured (Task 00)
- Claude Code SDK Docker container with ThreadManager (Task 01)
- Fargate with EFS mounting (Task 02)
- API keys in Secrets Manager (Task 00)
- Existing SES email service

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude Code SDK limitations | High | Thorough testing, fallback options |
| State management differences | Medium | Parallel session stores during transition |
| Email parsing edge cases | Low | Reuse existing parser |
| Performance regression | Medium | Benchmark and optimize |

## Estimated Effort

- Development: 4 days
- Testing: 1 day
- Documentation: 0.5 days
- **Total: 5.5 days**

## Success Metrics

- **Code Reduction**: > 50% fewer lines of code
- **Performance**: < 5s average response time
- **Reliability**: < 1% error rate
- **Maintainability**: Single service instead of complex graph
- **Developer Experience**: Simpler debugging and testing