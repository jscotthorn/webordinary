import { Injectable, Logger } from '@nestjs/common';
import { SQSClient, ChangeMessageVisibilityCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

@Injectable()
export class VisibilityExtensionService {
  private readonly logger = new Logger(VisibilityExtensionService.name);
  private readonly sqsClient: SQSClient;
  private visibilityInterval: NodeJS.Timeout | null = null;
  private currentReceiptHandle: string | null = null;
  private currentQueueUrl: string | null = null;

  constructor() {
    this.sqsClient = new SQSClient({
      region: process.env.AWS_REGION || 'us-west-2',
    });
  }

  /**
   * Start extending visibility timeout for a message
   * Extensions happen every 50 minutes (to stay within 60-minute limit)
   */
  startExtension(receiptHandle: string, queueUrl: string): void {
    this.stopExtension();

    this.currentReceiptHandle = receiptHandle;
    this.currentQueueUrl = queueUrl;

    this.logger.log('Starting visibility timeout extensions (every 50 minutes)');

    // Schedule first extension in 50 minutes
    this.scheduleNextExtension();
  }

  /**
   * Schedule the next visibility extension
   */
  private scheduleNextExtension(): void {
    this.visibilityInterval = setTimeout(async () => {
      try {
        await this.extendVisibility();
        // Schedule next extension
        this.scheduleNextExtension();
      } catch (error: any) {
        this.logger.error(`Failed to extend visibility: ${error.message}`);
        // Try again in 5 minutes if failed
        this.visibilityInterval = setTimeout(() => {
          this.scheduleNextExtension();
        }, 5 * 60 * 1000);
      }
    }, 50 * 60 * 1000); // 50 minutes
  }

  /**
   * Extend visibility timeout for current message
   */
  private async extendVisibility(): Promise<void> {
    if (!this.currentReceiptHandle || !this.currentQueueUrl) {
      this.logger.warn('No active message to extend visibility for');
      return;
    }

    const command = new ChangeMessageVisibilityCommand({
      QueueUrl: this.currentQueueUrl,
      ReceiptHandle: this.currentReceiptHandle,
      VisibilityTimeout: 3600, // Extend by another 60 minutes
    });

    await this.sqsClient.send(command);
    this.logger.log('Extended visibility timeout for another 60 minutes');
  }

  /**
   * Stop visibility extensions
   */
  stopExtension(): void {
    if (this.visibilityInterval) {
      clearTimeout(this.visibilityInterval);
      this.visibilityInterval = null;
    }
    this.currentReceiptHandle = null;
    this.currentQueueUrl = null;
  }

  /**
   * Delete the current message from the queue
   * Critical for unblocking FIFO queue on interruption
   */
  async deleteCurrentMessage(): Promise<void> {
    if (!this.currentReceiptHandle || !this.currentQueueUrl) {
      this.logger.warn('No active message to delete');
      return;
    }

    try {
      const command = new DeleteMessageCommand({
        QueueUrl: this.currentQueueUrl,
        ReceiptHandle: this.currentReceiptHandle,
      });

      await this.sqsClient.send(command);
      this.logger.log('Deleted message from queue (unblocking FIFO)');
    } catch (error: any) {
      this.logger.error(`Failed to delete message: ${error.message}`);
    } finally {
      this.stopExtension();
    }
  }

  /**
   * Get current message info
   */
  getCurrentMessage(): { receiptHandle: string | null; queueUrl: string | null } {
    return {
      receiptHandle: this.currentReceiptHandle,
      queueUrl: this.currentQueueUrl,
    };
  }
}