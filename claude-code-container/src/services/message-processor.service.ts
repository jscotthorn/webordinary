import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { SqsMessageHandler, SqsConsumerEventHandler } from '@ssut/nestjs-sqs';
import { Message } from '@aws-sdk/client-sqs';
import { OnEvent } from '@nestjs/event-emitter';
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';

import { ClaudeExecutorService } from './claude-executor.service';
import { GitService } from './git.service';
import { S3SyncService } from './s3-sync.service';
import { CommitMessageService } from './commit-message.service';
import { StepFunctionsCallbackService } from './stepfunctions-callback.service';
import { ActiveJobService } from './active-job.service';
import { VisibilityExtensionService } from './visibility-extension.service';
import { InterruptMessage } from './interrupt-handler.service';

interface StepFunctionMessage {
  taskToken: string;
  messageId: string;
  instruction: string;
  threadId: string;
  attachments?: any[];
  projectId: string;
  userId: string;
}

@Injectable()
export class MessageProcessor implements OnModuleDestroy {
  private readonly logger = new Logger(MessageProcessor.name);
  private readonly workspacePath: string;
  private currentProcess: ChildProcess | null = null;
  private currentSessionId: string | null = null;
  private isProcessing = false;
  private containerId: string;

  constructor(
    private readonly claudeExecutor: ClaudeExecutorService,
    private readonly gitService: GitService,
    private readonly s3SyncService: S3SyncService,
    private readonly commitMessageService: CommitMessageService,
    private readonly stepFunctions: StepFunctionsCallbackService,
    private readonly activeJobs: ActiveJobService,
    private readonly visibilityExtension: VisibilityExtensionService,
  ) {
    this.workspacePath = process.env.WORKSPACE_PATH || '/workspace';
    this.containerId = process.env.CONTAINER_ID || `container-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async onModuleDestroy() {
    // Clean up on shutdown
    await this.activeJobs.cleanup();
    this.stepFunctions.stopHeartbeat();
    this.visibilityExtension.stopExtension();
  }

  /**
   * Handle messages from Step Functions via SQS FIFO queue
   */
  @SqsMessageHandler('container-input', false)
  async handleMessage(message: Message) {
    if (!message.Body) {
      this.logger.error('Received message with no body');
      return;
    }

    const body: StepFunctionMessage = JSON.parse(message.Body);
    const projectUserKey = `${body.projectId}#${body.userId}`;

    this.logger.log(`Received Step Functions message for ${projectUserKey}`);
    this.logger.log(`Task token: ${body.taskToken?.substring(0, 20)}...`);

    // Prevent concurrent processing
    if (this.isProcessing) {
      this.logger.warn('Already processing a message, this should not happen with FIFO');
      return;
    }

    this.isProcessing = true;

    try {
      // Register active job in DynamoDB
      await this.activeJobs.registerJob({
        projectUserKey,
        messageId: body.messageId,
        taskToken: body.taskToken,
        receiptHandle: message.ReceiptHandle!,
        threadId: body.threadId,
        containerId: this.containerId,
      });

      // Start heartbeats to Step Functions (every 30 seconds)
      this.stepFunctions.startHeartbeat(body.taskToken, 30);

      // Start visibility timeout extensions (every 50 minutes)
      const queueUrl = `https://sqs.${process.env.AWS_REGION || 'us-west-2'}.amazonaws.com/${process.env.AWS_ACCOUNT_ID || '942734823970'}/webordinary-input-${body.projectId}-${body.userId}.fifo`;
      this.visibilityExtension.startExtension(message.ReceiptHandle!, queueUrl);

      // Set S3 sync context for this project/user
      this.s3SyncService.setContext(body.projectId, body.userId);

      // Switch to the correct git branch
      await this.switchToThread(body.threadId);

      // Process the message
      const result = await this.executeCompleteWorkflow(body);

      // Send success callback to Step Functions
      await this.stepFunctions.sendTaskSuccess(body.taskToken, {
        success: true,
        messageId: body.messageId,
        summary: result.summary,
        filesChanged: result.filesChanged,
        siteUrl: result.siteUrl,
        buildSuccess: result.buildSuccess,
        deploySuccess: result.deploySuccess,
      });

      this.logger.log('Successfully processed message and sent callback');

    } catch (error: any) {
      this.logger.error(`Failed to process message: ${error.message}`);

      // Send failure callback to Step Functions
      await this.stepFunctions.sendTaskFailure(
        body.taskToken,
        error.name || 'ProcessingError',
        error.message
      );

    } finally {
      // Clean up
      await this.activeJobs.clearJob(projectUserKey);
      this.stepFunctions.stopHeartbeat();
      this.visibilityExtension.stopExtension();
      this.isProcessing = false;
    }
  }

  /**
   * Handle interrupt messages
   */
  @OnEvent('interrupt')
  async handleInterrupt(interrupt: InterruptMessage) {
    this.logger.warn(`Processing interrupt: ${interrupt.reason}`);

    const currentJob = this.activeJobs.getCurrentJob();
    if (!currentJob) {
      this.logger.warn('No active job to interrupt');
      return;
    }

    try {
      // 1. Stop current processing
      await this.interruptCurrentProcess();

      // 2. Save partial work
      await this.savePartialWork();

      // 3. Delete FIFO message to unblock queue
      await this.visibilityExtension.deleteCurrentMessage();

      // 4. Send task failure with interruption flag
      await this.stepFunctions.sendTaskFailure(
        currentJob.taskToken,
        'PREEMPTED',
        `Interrupted by new message in thread ${interrupt.newThreadId}`
      );

      // 5. Clear active job
      await this.activeJobs.clearJob(currentJob.projectUserKey);

      this.logger.log('Interrupt handling complete, FIFO queue unblocked');

    } catch (error: any) {
      this.logger.error(`Failed to handle interrupt: ${error.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  @SqsConsumerEventHandler('container-input', 'error')
  async onError(error: Error, message: Message) {
    this.logger.error(`Error processing message: ${error.message}`, error.stack);
  }

  /**
   * Interrupt current process gracefully
   */
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

      this.currentProcess = null;
    }
  }

  /**
   * Save any partial work before interruption
   */
  private async savePartialWork(): Promise<void> {
    try {
      // Commit any uncommitted changes
      const commitContext = {
        interrupted: true,
        sessionId: this.currentSessionId,
        filesChanged: [],
      };
      const commitMessage = this.commitMessageService.generateCommitMessage(commitContext);
      await this.gitService.commitWithBody(commitMessage);

      // Push to GitHub
      if (process.env.GIT_PUSH_ENABLED !== 'false') {
        await this.gitService.safePush();
      }

      // If build was interrupted, sync partial build
      const currentJob = this.activeJobs.getCurrentJob();
      if (currentJob && this.currentProcess?.spawnfile === 'npm') {
        this.logger.log('Syncing partial build to S3...');
        await this.syncToS3WithInterrupt(currentJob.projectUserKey.split('#')[0]).catch(err =>
          this.logger.warn(`Failed to sync partial build: ${err.message}`)
        );
      }
    } catch (error: any) {
      this.logger.error(`Failed to save partial work: ${error.message}`);
    }
  }

  /**
   * Switch to the correct git branch for the thread
   */
  private async switchToThread(threadId: string): Promise<void> {
    const branch = threadId.startsWith('thread-') ? threadId : `thread-${threadId}`;

    // Commit current changes if any
    if (this.currentSessionId) {
      const commitContext = {
        instruction: 'Switching threads',
        sessionId: this.currentSessionId,
        filesChanged: [],
      };
      const commitMessage = this.commitMessageService.generateCommitMessage(commitContext);
      await this.gitService.commitWithBody(commitMessage);
    }

    // Switch branch
    const switchSuccess = await this.gitService.safeBranchSwitch(branch);
    if (!switchSuccess) {
      this.logger.warn('Safe switch failed, attempting recovery...');
      await this.gitService.recoverRepository();
      await this.gitService.checkoutBranch(branch).catch(() => {
        return this.gitService.createBranch(branch);
      });
    }

    this.currentSessionId = threadId;
    this.logger.log(`Switched to thread ${threadId} (branch: ${branch})`);
  }

  /**
   * Execute the complete workflow
   */
  private async executeCompleteWorkflow(message: StepFunctionMessage): Promise<any> {
    const result: any = {
      filesChanged: [],
      summary: '',
      siteUrl: this.s3SyncService.getDeployedUrl(message.projectId),
      buildSuccess: false,
      deploySuccess: false,
    };

    try {
      // Step 1: Execute Claude Code
      this.logger.log('Step 1/5: Executing Claude command...');
      const claudeResult = await this.executeClaudeCode(message);
      result.filesChanged = claudeResult.filesChanged || [];
      result.summary = claudeResult.output || '';

      // Step 2: Commit changes
      if (result.filesChanged.length > 0) {
        this.logger.log('Step 2/5: Committing changes...');
        const commitContext = {
          instruction: message.instruction,
          filesChanged: result.filesChanged,
          sessionId: message.threadId,
          userId: message.userId,
          timestamp: Date.now(),
        };
        const commitMessage = this.commitMessageService.generateCommitMessage(commitContext);
        const commitBody = this.commitMessageService.generateCommitBody(commitContext);
        await this.gitService.commitWithBody(commitMessage, commitBody);
      }

      // Step 3: Build
      this.logger.log('Step 3/5: Building Astro site...');
      result.buildSuccess = await this.buildAstroWithInterrupt();

      if (result.buildSuccess) {
        // Step 4: Deploy to S3
        this.logger.log('Step 4/5: Deploying to S3...');
        result.deploySuccess = await this.syncToS3WithInterrupt(message.projectId);

        // Step 5: Push to GitHub
        if (process.env.GIT_PUSH_ENABLED !== 'false') {
          this.logger.log('Step 5/5: Pushing to GitHub...');
          await this.gitService.safePush();
        }
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Workflow failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute Claude Code with the instruction
   */
  private async executeClaudeCode(message: StepFunctionMessage): Promise<any> {
    try {
      const projectPath = this.getProjectPath(message.projectId, message.userId);
      
      const contextWithPath = {
        ...message,
        projectPath,
        attachments: message.attachments || [],
      };

      const result = await this.claudeExecutor.execute(
        message.instruction,
        contextWithPath
      );

      return {
        output: result.output || result.summary || 'Instruction processed',
        filesChanged: result.filesChanged || [],
        summary: result.summary || result.output,
        success: result.success !== false,
      };
    } catch (error: any) {
      if (error.message === 'Process interrupted') {
        throw new Error('InterruptError');
      }
      throw error;
    }
  }

  /**
   * Build Astro with interruption support
   */
  private async buildAstroWithInterrupt(): Promise<boolean> {
    const currentJob = this.activeJobs.getCurrentJob();
    if (!currentJob) return false;

    const projectPath = this.getProjectPath(
      currentJob.projectUserKey.split('#')[0],
      currentJob.projectUserKey.split('#')[1]
    );

    return new Promise((resolve, reject) => {
      const buildProcess = spawn('npm', ['run', 'build'], {
        cwd: projectPath,
        env: { ...process.env, NODE_ENV: 'production' }
      });

      this.currentProcess = buildProcess;

      let errorOutput = '';

      buildProcess.stdout?.on('data', (data) => {
        this.logger.debug(`Build: ${data.toString().trim()}`);
      });

      buildProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
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
          this.logger.warn('Build interrupted');
          reject(new Error('InterruptError'));
        } else {
          this.logger.error(`Build failed with code ${code}: ${errorOutput}`);
          resolve(false);
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
   * Sync to S3 with interruption support
   */
  private async syncToS3WithInterrupt(projectId: string): Promise<boolean> {
    const currentJob = this.activeJobs.getCurrentJob();
    if (!currentJob) return false;

    const [project, user] = currentJob.projectUserKey.split('#');
    const projectPath = this.getProjectPath(project, user);
    const distPath = `${projectPath}/dist`;
    const bucket = `edit.${projectId}.webordinary.com`;

    // Check if dist folder exists
    try {
      await promisify(exec)(`ls -la ${distPath}`);
    } catch {
      this.logger.warn('Dist folder not found, skipping S3 sync');
      return false;
    }

    return new Promise((resolve) => {
      const syncProcess = spawn('aws', [
        's3', 'sync', distPath, `s3://${bucket}`,
        '--delete', '--region', 'us-west-2'
      ], {
        env: { ...process.env }
      });

      this.currentProcess = syncProcess;

      let syncOutput = '';
      let errorOutput = '';

      syncProcess.stdout?.on('data', (data) => {
        syncOutput += data.toString();
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
          const uploadCount = (syncOutput.match(/upload:/g) || []).length;
          const deleteCount = (syncOutput.match(/delete:/g) || []).length;
          this.logger.log(`✅ S3 sync complete: ${uploadCount} uploaded, ${deleteCount} deleted`);
          this.logger.log(`🌐 Site updated at https://${bucket}`);
          resolve(true);
        } else if (code === 130) {
          this.logger.warn('S3 sync interrupted');
          resolve(false);
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
   * Get project path
   */
  private getProjectPath(projectId: string, userId: string): string {
    // TODO: Make repo name configurable per project
    return `${this.workspacePath}/${projectId}/${userId}/amelia-astro`;
  }
}