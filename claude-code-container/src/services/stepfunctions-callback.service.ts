import { Injectable, Logger } from '@nestjs/common';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand, SendTaskHeartbeatCommand } from '@aws-sdk/client-sfn';

@Injectable()
export class StepFunctionsCallbackService {
  private readonly logger = new Logger(StepFunctionsCallbackService.name);
  private readonly sfnClient: SFNClient;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private currentTaskToken: string | null = null;

  constructor() {
    this.sfnClient = new SFNClient({
      region: process.env.AWS_REGION || 'us-west-2',
    });
  }

  /**
   * Start heartbeat for a task token
   * @param taskToken The Step Functions task token
   * @param intervalSeconds Heartbeat interval in seconds (default 30 per proposal)
   */
  startHeartbeat(taskToken: string, intervalSeconds = 30): void {
    this.stopHeartbeat(); // Stop any existing heartbeat
    this.currentTaskToken = taskToken;

    this.logger.log(`Starting heartbeat for task token (every ${intervalSeconds}s)`);

    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.sendHeartbeat(taskToken);
      } catch (error: any) {
        this.logger.error(`Failed to send heartbeat: ${error.message}`);
        // Don't stop heartbeat on failure - Step Functions will handle timeout
      }
    }, intervalSeconds * 1000);

    // Send first heartbeat immediately
    this.sendHeartbeat(taskToken).catch(err => 
      this.logger.warn(`Initial heartbeat failed: ${err.message}`)
    );
  }

  /**
   * Stop the heartbeat interval
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      this.currentTaskToken = null;
      this.logger.log('Stopped heartbeat');
    }
  }

  /**
   * Send a heartbeat to Step Functions
   */
  private async sendHeartbeat(taskToken: string): Promise<void> {
    const command = new SendTaskHeartbeatCommand({
      taskToken,
    });

    await this.sfnClient.send(command);
    this.logger.debug('Heartbeat sent successfully');
  }

  /**
   * Send task success to Step Functions
   */
  async sendTaskSuccess(taskToken: string, output: any): Promise<void> {
    this.stopHeartbeat(); // Stop heartbeat when task completes

    const command = new SendTaskSuccessCommand({
      taskToken,
      output: JSON.stringify(output),
    });

    try {
      await this.sfnClient.send(command);
      this.logger.log('Task success sent to Step Functions');
    } catch (error: any) {
      this.logger.error(`Failed to send task success: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send task failure to Step Functions
   */
  async sendTaskFailure(taskToken: string, error: string, cause?: string): Promise<void> {
    this.stopHeartbeat(); // Stop heartbeat when task fails

    const command = new SendTaskFailureCommand({
      taskToken,
      error: error.substring(0, 256), // Max 256 characters
      cause: cause?.substring(0, 32768), // Max 32KB
    });

    try {
      await this.sfnClient.send(command);
      this.logger.log('Task failure sent to Step Functions');
    } catch (err: any) {
      this.logger.error(`Failed to send task failure: ${err.message}`);
      throw err;
    }
  }

  /**
   * Check if we're currently processing a task
   */
  isProcessingTask(): boolean {
    return this.currentTaskToken !== null;
  }

  /**
   * Get the current task token
   */
  getCurrentTaskToken(): string | null {
    return this.currentTaskToken;
  }
}