import { Injectable, Logger } from '@nestjs/common';
import { SqsMessageHandler, SqsConsumerEventHandler } from '@ssut/nestjs-sqs';
import { SqsService } from '@ssut/nestjs-sqs';
import { Message } from '@aws-sdk/client-sqs';
import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import { ClaudeExecutorService } from './claude-executor.service';
import { GitService } from './git.service';
import { S3SyncService } from './s3-sync.service';
import { CommitMessageService } from './commit-message.service';
import { QueueManagerService } from './queue-manager.service';
import type { ResponseMessage } from '../types/queue-messages';
import { isWorkMessage } from '../types/queue-messages';

@Injectable()
export class MessageProcessor {
  private readonly logger = new Logger(MessageProcessor.name);
  private readonly workspacePath: string;
  private currentProcess: ChildProcess | null = null;
  private currentSessionId: string | null = null;
  private currentCommandId: string | null = null;

  constructor(
    private readonly sqsService: SqsService,
    private readonly claudeExecutor: ClaudeExecutorService,
    private readonly gitService: GitService,
    private readonly s3SyncService: S3SyncService,
    private readonly commitMessageService: CommitMessageService,
    private readonly queueManager: QueueManagerService,
  ) {
    this.workspacePath = process.env.WORKSPACE_PATH || '/workspace';
  }

  @SqsMessageHandler('container-input', false)
  async handleMessage(message: Message) {
    if (!message.Body) {
      this.logger.error('Received message with no body');
      return;
    }

    const body = JSON.parse(message.Body);

    // Validate it's a work message
    if (!isWorkMessage(body)) {
      this.logger.error(`Invalid message type: ${(body as any).type || 'undefined'}`);
      return;
    }

    this.logger.log(`Received work message for session ${body.sessionId}`);

    // Initialize repository if repo URL is provided
    if (body.repoUrl) {
      this.logger.log(`Initializing repository from: ${body.repoUrl}`);
      try {
        await this.gitService.initRepository(body.repoUrl);
      } catch (error: any) {
        this.logger.warn(`Repository initialization failed (may already exist): ${error.message}`);
        // Continue anyway - the repository might already be initialized
      }
    }

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
      // Execute complete workflow with proper sequencing
      const result = await this.executeCompleteWorkflow(body);

      // Send success response
      const successResponse: ResponseMessage = {
        type: 'response',
        sessionId: body.sessionId,
        projectId: body.projectId,
        userId: body.userId,
        commandId: body.commandId || '',
        timestamp: new Date().toISOString(),
        success: true,
        summary: result.summary,
        filesChanged: result.filesChanged,
        previewUrl: result.siteUrl,
        buildSuccess: result.buildSuccess,
        deploySuccess: result.deploySuccess,
      };
      await this.sendResponse(successResponse);
    } catch (error: any) {
      if (error.message === 'InterruptError') {
        // Send interrupt notification
        const interruptResponse: ResponseMessage = {
          type: 'response',
          sessionId: body.sessionId,
          projectId: body.projectId,
          userId: body.userId,
          commandId: body.commandId || '',
          timestamp: new Date().toISOString(),
          success: false,
          summary: 'Process interrupted by new message',
          interrupted: true,
        };
        await this.sendResponse(interruptResponse);
      } else {
        // Send error response
        const errorResponse: ResponseMessage = {
          type: 'response',
          sessionId: body.sessionId,
          projectId: body.projectId,
          userId: body.userId,
          commandId: body.commandId || '',
          timestamp: new Date().toISOString(),
          success: false,
          error: error.message,
        };
        await this.sendResponse(errorResponse);
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
      const processName = this.currentProcess.spawnfile;
      this.logger.log(`Interrupting ${processName} process...`);

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

      // Auto-commit any changes with meaningful message
      const commitContext = {
        interrupted: true,
        sessionId: this.currentSessionId,
        filesChanged: [],  // We don't have file list at interrupt time
      };
      const commitMessage = this.commitMessageService.generateCommitMessage(commitContext);
      await this.gitService.commitWithBody(commitMessage);

      // If we interrupted a build, try to sync whatever was built
      if (processName === 'npm') {
        this.logger.log('Build was interrupted, attempting S3 sync of partial build...');
        const claim = this.queueManager.getCurrentClaim();
        const clientId = claim?.projectId || 'ameliastamps';
        await this.syncToS3WithInterrupt(clientId).catch(err =>
          this.logger.warn(`Failed to sync partial build: ${err.message}`)
        );
      }

      // If we interrupted S3 sync, partial files may have been uploaded
      if (processName === 'aws') {
        this.logger.log('S3 sync was interrupted, partial deployment may be available');
      }

      // Push any committed changes with conflict handling
      if (process.env.GIT_PUSH_ENABLED !== 'false') {
        await this.gitService.safePush();
      }

      this.currentProcess = null;
    }
  }

  private async switchToSession(sessionId: string, chatThreadId: string): Promise<void> {
    // chatThreadId may already have 'thread-' prefix from Hermes
    const branch = chatThreadId.startsWith('thread-') ? chatThreadId : `thread-${chatThreadId}`;

    // Commit current changes if any
    if (this.currentSessionId) {
      const commitContext = {
        instruction: 'Switching sessions',
        sessionId: this.currentSessionId,
        filesChanged: [],
      };
      const commitMessage = this.commitMessageService.generateCommitMessage(commitContext);
      await this.gitService.commitWithBody(commitMessage);
    }

    // Use safe branch switch with stash support
    const switchSuccess = await this.gitService.safeBranchSwitch(branch);

    if (!switchSuccess) {
      // Fall back to recovery and force checkout
      this.logger.warn('Safe switch failed, attempting recovery...');
      try {
        await this.gitService.recoverRepository();
        // Try again after recovery
        await this.gitService.checkoutBranch(branch);
      } catch {
        // Create branch if it doesn't exist
        await this.gitService.createBranch(branch);
      }
    }

    this.currentSessionId = sessionId;
    this.logger.log(`Switched to session ${sessionId} (branch: ${branch})`);
  }

  private async executeClaudeCode(message: any): Promise<any> {
    try {
      this.logger.log('Executing instruction with ClaudeExecutorService');

      // Get the project workspace path for Claude to work in
      const projectPath = this.getProjectPath();

      // Add project path to context
      const contextWithPath = {
        ...message.context,
        projectPath
      };

      // Use the ClaudeExecutorService to process the instruction
      const result = await this.claudeExecutor.execute(
        message.instruction,
        contextWithPath
      );

      // Ensure result has the expected structure
      return {
        output: result.output || result.summary || 'Instruction processed',
        filesChanged: result.filesChanged || [],
        summary: result.summary || result.output,
        success: result.success !== false,
      };
    } catch (error: any) {
      // Check if it was an interruption
      if (error.message === 'Process interrupted') {
        throw new Error('InterruptError');
      }

      this.logger.error(`Failed to execute Claude Code: ${error.message}`);
      throw error;
    }
  }

  private async sendResponse(response: ResponseMessage): Promise<void> {
    // Use QueueManagerService if available, otherwise fallback to static queue
    const queueManager = (this as any).queueManager;
    if (queueManager) {
      await queueManager.sendResponse(response);
    } else if (process.env.OUTPUT_QUEUE_URL) {
      // Fallback to static queue if configured
      await this.sqsService.send('container-output', {
        id: response.commandId,
        body: response,
      });
    } else {
      this.logger.warn('No output queue available for response');
    }
  }

  /**
   * Extract a meaningful commit message from the message body
   * @deprecated Use commitMessageService.generateCommitMessage instead
   */
  private extractCommitMessage(message: any): string {
    // Use instruction or command as commit message
    const instruction = message.instruction || message.command || 'Claude changes';
    const sessionId = message.sessionId?.substring(0, 8) || 'unknown';

    // Truncate long instructions to fit in commit message
    const truncatedInstruction = instruction.length > 100
      ? instruction.substring(0, 97) + '...'
      : instruction;

    return `[${sessionId}] ${truncatedInstruction}`;
  }

  /**
   * Execute the complete workflow: Claude -> Commit -> Build -> Deploy -> Push
   */
  private async executeCompleteWorkflow(message: any): Promise<any> {
    const result: any = {
      filesChanged: [],
      summary: '',
      siteUrl: this.s3SyncService.getDeployedUrl(message.clientId),
      buildSuccess: false,
      deploySuccess: false,
    };

    try {
      // Step 1: Execute Claude Code
      this.logger.log('Step 1/5: Executing Claude command...');
      const claudeResult = await this.executeClaudeCode(message);
      result.filesChanged = claudeResult.filesChanged || [];
      result.summary = claudeResult.output || '';

      // Step 2: Commit changes (don't push yet)
      if (result.filesChanged.length > 0) {
        this.logger.log('Step 2/5: Committing changes...');

        // Generate meaningful commit message
        const commitContext = {
          instruction: message.instruction,
          command: message.command,
          filesChanged: result.filesChanged,
          sessionId: message.sessionId,
          userId: message.userId,
          timestamp: Date.now(),
        };

        const commitMessage = this.commitMessageService.generateCommitMessage(commitContext);
        const commitBody = this.commitMessageService.generateCommitBody(commitContext);

        // Use new commit method with body support
        await this.gitService.commitWithBody(commitMessage, commitBody);
      } else {
        this.logger.log('Step 2/5: No files changed, skipping commit');
      }

      // Step 3: Build Astro project
      this.logger.log('Step 3/5: Building Astro site...');
      result.buildSuccess = await this.buildAstroWithInterrupt();

      if (result.buildSuccess) {
        // Step 4: Sync to S3
        this.logger.log('Step 4/5: Deploying to S3...');
        result.deploySuccess = await this.syncToS3WithInterrupt(message.clientId);

        // Step 5: Push commits to GitHub with conflict handling
        if (process.env.GIT_PUSH_ENABLED !== 'false') {
          this.logger.log('Step 5/5: Pushing to GitHub...');
          const pushSuccess = await this.gitService.safePush();
          if (!pushSuccess) {
            this.logger.warn('Failed to push to GitHub after conflict resolution, but continuing');
            // Could queue for later retry or notify user
          } else {
            this.logger.log('Successfully pushed changes to GitHub');
          }
        } else {
          this.logger.log('Step 5/5: Git push disabled, skipping');
        }
      } else {
        this.logger.warn('Build failed, skipping deployment');
        // Still try to push commits even if build failed
        if (process.env.GIT_PUSH_ENABLED !== 'false') {
          this.logger.log('Attempting to push commits despite build failure...');
          await this.gitService.safePush();
        }
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Workflow failed at step: ${error.message}`);

      // Try to push whatever we have committed
      if (process.env.GIT_PUSH_ENABLED !== 'false') {
        this.logger.log('Attempting to push any committed changes...');
        await this.gitService.safePush();
      }

      throw error;
    }
  }

  /**
   * Build Astro project with interrupt support
   */
  private async buildAstroWithInterrupt(): Promise<boolean> {
    const projectPath = this.getProjectPath();

    return new Promise((resolve, reject) => {
      const buildProcess = spawn('npm', ['run', 'build'], {
        cwd: projectPath,
        env: { ...process.env, NODE_ENV: 'production' }
      });

      // Track for interruption
      this.currentProcess = buildProcess;

      let buildOutput = '';
      let errorOutput = '';

      buildProcess.stdout?.on('data', (data) => {
        buildOutput += data.toString();
        this.logger.debug(`Build: ${data.toString().trim()}`);
      });

      buildProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
        // Don't log warnings as errors
        if (!data.toString().includes('warning')) {
          this.logger.debug(`Build stderr: ${data.toString().trim()}`);
        }
      });

      buildProcess.on('exit', (code) => {
        this.currentProcess = null;

        if (code === 0) {
          this.logger.log('✅ Astro build successful');
          resolve(true);
        } else if (code === 130) { // SIGINT
          this.logger.warn('Build interrupted by new message');
          reject(new Error('InterruptError'));
        } else {
          this.logger.error(`Build failed with code ${code}: ${errorOutput}`);
          resolve(false); // Don't fail workflow on build error
        }
      });

      buildProcess.on('error', (error) => {
        this.currentProcess = null;
        this.logger.error('Build process error:', error);
        resolve(false);
      });
    });
  }

  /**
   * Sync to S3 with interrupt support
   */
  private async syncToS3WithInterrupt(clientId: string): Promise<boolean> {
    const projectPath = this.getProjectPath();
    const distPath = `${projectPath}/dist`;
    const bucket = `edit.${clientId || 'ameliastamps'}.webordinary.com`;

    // Check if dist folder exists
    try {
      await promisify(exec)(`ls -la ${distPath}`);
    } catch {
      this.logger.warn('Dist folder not found, skipping S3 sync');
      return false;
    }

    return new Promise((resolve) => {
      const syncCommand = `aws s3 sync ${distPath} s3://${bucket} --delete --region us-west-2`;
      this.logger.debug(`S3 sync command: ${syncCommand}`);

      const syncProcess = spawn('aws', [
        's3', 'sync', distPath, `s3://${bucket}`,
        '--delete', '--region', 'us-west-2'
      ], {
        env: { ...process.env }
      });

      // Track for interruption
      this.currentProcess = syncProcess;

      let syncOutput = '';
      let errorOutput = '';

      syncProcess.stdout?.on('data', (data) => {
        syncOutput += data.toString();
        // Count files being uploaded
        const uploads = (data.toString().match(/upload:/g) || []).length;
        if (uploads > 0) {
          this.logger.debug(`Uploading ${uploads} files...`);
        }
      });

      syncProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
        if (!data.toString().includes('warning')) {
          this.logger.debug(`S3 sync stderr: ${data.toString().trim()}`);
        }
      });

      syncProcess.on('exit', (code) => {
        this.currentProcess = null;

        if (code === 0) {
          // Count total uploads/deletes
          const uploadCount = (syncOutput.match(/upload:/g) || []).length;
          const deleteCount = (syncOutput.match(/delete:/g) || []).length;

          if (uploadCount > 0 || deleteCount > 0) {
            this.logger.log(`✅ S3 sync complete: ${uploadCount} uploaded, ${deleteCount} deleted`);
          } else {
            this.logger.log('✅ S3 sync complete: no changes');
          }

          this.logger.log(`🌐 Site updated at https://${bucket}`);
          resolve(true);
        } else if (code === 130) { // SIGINT
          this.logger.warn('S3 sync interrupted by new message');
          resolve(false); // Partial sync, don't fail
        } else {
          this.logger.error(`S3 sync failed with code ${code}: ${errorOutput}`);
          resolve(false);
        }
      });

      syncProcess.on('error', (error) => {
        this.currentProcess = null;
        this.logger.error('S3 sync process error:', error);
        resolve(false);
      });
    });
  }

  /**
   * Get the project path for the current client/user
   * This returns the full path including the repository name
   */
  private getProjectPath(): string {
    const claim = this.queueManager.getCurrentClaim();
    if (!claim) {
      // Fallback for legacy tests or initialization
      return `${this.workspacePath}/unclaimed/workspace`;
    }
    const { projectId, userId } = claim;
    // Include the repo name for Astro builds and S3 sync
    // TODO: Make repo name configurable per project
    return `${this.workspacePath}/${projectId}/${userId}/amelia-astro`;
  }

}