# Task 11: Container SQS Polling with NestJS Integration

## Objective
Implement SQS message handling in the edit container using @nestjs-packages/sqs, with automatic interrupt handling for concurrent messages from the single queue per container.

## Requirements

### Single Queue SQS Consumer
1. **Queue Configuration**:
   - Container receives its queue URLs via environment variables
   - One input queue per container: `webordinary-input-{clientId}-{projectId}-{userId}`
   - One output queue per container: `webordinary-output-{clientId}-{projectId}-{userId}`
   - No queue discovery needed - container knows its own queue

2. **Interrupt Handling**:
   - Any new message automatically interrupts current Claude process
   - Save partial progress before processing new message
   - Switch git branches based on session ID in message

3. **Message Processing**:
   - Process messages sequentially (one at a time)
   - Decorator-based handling with @nestjs-packages/sqs
   - Maintain session context across interrupts

## Implementation

### NestJS Module Setup

```typescript
// claude-code-container/src/app.module.ts
import { Module } from '@nestjs/common';
import { SqsModule } from '@nestjs-packages/sqs';
import { MessageProcessor } from './message-processor.service';

@Module({
  imports: [
    SqsModule.register({
      consumers: [
        {
          name: 'container-input',
          queueUrl: process.env.INPUT_QUEUE_URL,
          pollingWaitTimeMs: 20000, // Long polling
          handleMessageBatch: false,
          batchSize: 1, // Process one at a time
          visibilityTimeout: 300, // 5 minutes
        },
      ],
      producers: [
        {
          name: 'container-output',
          queueUrl: process.env.OUTPUT_QUEUE_URL,
        },
      ],
    }),
  ],
  providers: [MessageProcessor],
})
export class AppModule {}
```

### Message Processor with Interrupt Handling

```typescript
// claude-code-container/src/message-processor.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SqsMessageHandler, SqsConsumerEventHandler } from '@nestjs-packages/sqs';
import { SqsService } from '@nestjs-packages/sqs';
import { Message } from '@aws-sdk/client-sqs';
import { spawn, ChildProcess } from 'child_process';

@Injectable()
export class MessageProcessor {
  private readonly logger = new Logger(MessageProcessor.name);
  private currentProcess: ChildProcess | null = null;
  private currentSessionId: string | null = null;
  private currentCommandId: string | null = null;

  constructor(private readonly sqsService: SqsService) {}

  @SqsMessageHandler('container-input', false)
  async handleMessage(message: Message) {
    const body = JSON.parse(message.Body);
    
    this.logger.log(`Received message for session ${body.sessionId}`);
    
    // Any new message interrupts current work
    if (this.currentProcess) {
      this.logger.warn(`Interrupting current command ${this.currentCommandId}`);
      await this.interruptCurrentProcess();
    }
    
    // Switch git branch if different session
    if (body.sessionId !== this.currentSessionId) {
      await this.switchToSession(body.sessionId, body.chatThreadId);
    }
    
    // Process the new message
    this.currentSessionId = body.sessionId;
    this.currentCommandId = body.commandId;
    
    try {
      const result = await this.executeClaudeCode(body);
      
      // Send success response
      await this.sendResponse({
        sessionId: body.sessionId,
        commandId: body.commandId,
        timestamp: Date.now(),
        success: true,
        summary: result.output,
        filesChanged: result.filesChanged,
        previewUrl: this.getPreviewUrl(body.sessionId),
      });
    } catch (error) {
      if (error.message === 'InterruptError') {
        // Send interrupt notification
        await this.sendResponse({
          sessionId: body.sessionId,
          commandId: body.commandId,
          timestamp: Date.now(),
          success: false,
          summary: 'Process interrupted by new message',
          interrupted: true,
        });
      } else {
        // Send error response
        await this.sendResponse({
          sessionId: body.sessionId,
          commandId: body.commandId,
          timestamp: Date.now(),
          success: false,
          error: error.message,
        });
      }
    } finally {
      this.currentProcess = null;
    }
  }

  @SqsConsumerEventHandler('container-input', 'error')
  async onError(error: Error, message: Message) {
    this.logger.error(`Error processing message: ${error.message}`, error.stack);
    // Message will be retried or sent to DLQ based on queue configuration
  }

  @SqsConsumerEventHandler('container-input', 'processingError')
  async onProcessingError(error: Error, message: Message) {
    this.logger.error(`Processing error: ${error.message}`, error.stack);
  }

  private async interruptCurrentProcess(): Promise<void> {
    if (this.currentProcess) {
      // Send SIGINT for graceful shutdown
      this.currentProcess.kill('SIGINT');
      
      // Wait for process to save state (max 5 seconds)
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 5000);
        this.currentProcess.once('exit', () => {
          clearTimeout(timeout);
          resolve(undefined);
        });
      });
      
      // Auto-commit any changes
      await this.autoCommitChanges('Interrupted by new message');
      
      this.currentProcess = null;
    }
  }

  private async switchToSession(sessionId: string, chatThreadId: string): Promise<void> {
    const branch = `thread-${chatThreadId}`;
    
    // Commit current changes if any
    if (this.currentSessionId) {
      await this.autoCommitChanges('Switching sessions');
    }
    
    // Switch to session branch
    try {
      await this.execCommand(`git checkout ${branch}`);
    } catch {
      // Create branch if it doesn't exist
      await this.execCommand(`git checkout -b ${branch}`);
    }
    
    this.currentSessionId = sessionId;
    this.logger.log(`Switched to session ${sessionId} (branch: ${branch})`);
  }

  private async executeClaudeCode(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      // Start Claude Code process
      this.currentProcess = spawn('claude-code', [
        '--instruction', message.instruction,
        '--context', JSON.stringify(message.context),
        '--workspace', process.env.WORKSPACE_PATH,
      ]);
      
      let output = '';
      let errorOutput = '';
      
      this.currentProcess.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      this.currentProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      this.currentProcess.on('exit', (code) => {
        if (code === 0) {
          try {
            resolve(JSON.parse(output));
          } catch {
            resolve({ output, filesChanged: [] });
          }
        } else if (code === 130) { // SIGINT
          reject(new Error('InterruptError'));
        } else {
          reject(new Error(`Process failed: ${errorOutput}`));
        }
      });
      
      this.currentProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  private async sendResponse(response: any): Promise<void> {
    await this.sqsService.send('container-output', {
      id: response.commandId,
      body: response,
    });
  }

  private async autoCommitChanges(message: string): Promise<void> {
    try {
      await this.execCommand('git add -A');
      await this.execCommand(`git commit -m "Auto-save: ${message}"`);
    } catch (error) {
      // No changes to commit
      this.logger.debug('No changes to commit');
    }
  }

  private async execCommand(command: string): Promise<string> {
    const { exec } = require('child_process');
    return new Promise((resolve, reject) => {
      exec(command, { cwd: process.env.WORKSPACE_PATH }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${command} failed: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  private getPreviewUrl(sessionId: string): string {
    const domain = process.env.PREVIEW_DOMAIN || 'preview.webordinary.com';
    return `https://${domain}/session/${sessionId}/`;
  }
}
```

### Container Startup Script

```typescript
// claude-code-container/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { spawn } from 'child_process';

async function bootstrap() {
  // Start Astro dev server in background
  const astroProcess = spawn('npm', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', '4321'], {
    cwd: process.env.WORKSPACE_PATH,
    stdio: 'inherit',
  });

  // Start NestJS application for SQS processing
  const app = await NestFactory.createApplicationContext(AppModule);
  
  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    astroProcess.kill('SIGTERM');
    await app.close();
    process.exit(0);
  });

  console.log('Container started successfully');
  console.log(`- Astro dev server on port 4321`);
  console.log(`- Processing SQS messages from ${process.env.INPUT_QUEUE_URL}`);
}

bootstrap();
```

### Environment Variables

```bash
# Container receives these from Fargate task definition
INPUT_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/xxx/webordinary-input-ameliastamps-website-john
OUTPUT_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/xxx/webordinary-output-ameliastamps-website-john
WORKSPACE_PATH=/workspace
CLIENT_ID=ameliastamps
PROJECT_ID=website
USER_ID=john
PREVIEW_DOMAIN=preview.webordinary.com
```

## Message Schema

```typescript
// Input message from Hermes
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

// Output message to Hermes
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

## Success Criteria
- [ ] Container uses @nestjs-packages/sqs for SQS handling
- [ ] Single queue per container (no discovery needed)
- [ ] Automatic interrupt on new message arrival
- [ ] Git branches switched based on session ID
- [ ] Partial work saved on interrupt
- [ ] Astro dev server continues running
- [ ] Decorator-based message handling

## Testing
- Test interrupt handling with rapid message sending
- Verify git branch switching between sessions
- Test auto-commit on interrupts
- Confirm message acknowledgment and error handling
- Load test with continuous message flow