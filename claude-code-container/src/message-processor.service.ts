import { Injectable, Logger } from '@nestjs/common';
import { SqsMessageHandler, SqsConsumerEventHandler } from '@ssut/nestjs-sqs';
import { SqsService } from '@ssut/nestjs-sqs';
import { Message } from '@aws-sdk/client-sqs';
import { spawn, ChildProcess } from 'child_process';
import { ClaudeExecutorService } from './services/claude-executor.service';
import { GitService } from './services/git.service';

@Injectable()
export class MessageProcessor {
  private readonly logger = new Logger(MessageProcessor.name);
  private currentProcess: ChildProcess | null = null;
  private currentSessionId: string | null = null;
  private currentCommandId: string | null = null;

  constructor(
    private readonly sqsService: SqsService,
    private readonly claudeExecutor: ClaudeExecutorService,
    private readonly gitService: GitService,
  ) {}

  @SqsMessageHandler('container-input', false)
  async handleMessage(message: Message) {
    if (!message.Body) {
      this.logger.error('Received message with no body');
      return;
    }

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
    } catch (error: any) {
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

  @SqsConsumerEventHandler('container-input', 'processing_error')
  async onProcessingError(error: Error, message: Message) {
    this.logger.error(`Processing error: ${error.message}`, error.stack);
  }

  private async interruptCurrentProcess(): Promise<void> {
    if (this.currentProcess) {
      // Send SIGINT for graceful shutdown
      this.currentProcess.kill('SIGINT');
      
      // Wait for process to save state (max 5 seconds)
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 5000);
        this.currentProcess?.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      
      // Auto-commit any changes
      await this.gitService.autoCommitChanges('Interrupted by new message');
      
      this.currentProcess = null;
    }
  }

  private async switchToSession(sessionId: string, chatThreadId: string): Promise<void> {
    const branch = `thread-${chatThreadId}`;
    
    // Commit current changes if any
    if (this.currentSessionId) {
      await this.gitService.autoCommitChanges('Switching sessions');
    }
    
    // Switch to session branch
    try {
      await this.gitService.checkoutBranch(branch);
    } catch {
      // Create branch if it doesn't exist
      await this.gitService.createBranch(branch);
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
        '--workspace', process.env.WORKSPACE_PATH || '/workspace',
      ], {
        cwd: process.env.WORKSPACE_PATH || '/workspace',
      });
      
      let output = '';
      let errorOutput = '';
      
      this.currentProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });
      
      this.currentProcess.stderr?.on('data', (data) => {
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

  private getPreviewUrl(sessionId: string): string {
    // Now using S3 static hosting via CloudFront
    const domain = process.env.S3_SITE_DOMAIN || 'edit.amelia.webordinary.com';
    return `https://${domain}/`;
  }
}