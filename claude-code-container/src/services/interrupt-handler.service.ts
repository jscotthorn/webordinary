import { Injectable, Logger } from '@nestjs/common';
import { SqsMessageHandler, SqsConsumerEventHandler } from '@ssut/nestjs-sqs';
import { Message } from '@aws-sdk/client-sqs';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface InterruptMessage {
  messageId: string;
  newThreadId: string;
  reason: string;
  timestamp: string;
}

@Injectable()
export class InterruptHandlerService {
  private readonly logger = new Logger(InterruptHandlerService.name);
  private readonly containerId: string;

  constructor(private eventEmitter: EventEmitter2) {
    // Generate or get container ID from environment
    this.containerId = process.env.CONTAINER_ID || `container-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.logger.log(`Container ID: ${this.containerId}`);
  }

  /**
   * Get the interrupt queue name for this container
   */
  getInterruptQueueName(): string {
    return `webordinary-interrupts-${this.containerId}`;
  }

  /**
   * Handle interrupt messages from the Standard queue
   * This bypasses FIFO blocking for immediate interruption
   */
  @SqsMessageHandler('container-interrupts', false)
  async handleInterrupt(message: Message) {
    if (!message.Body) {
      this.logger.error('Received interrupt message with no body');
      return;
    }

    try {
      const interrupt: InterruptMessage = JSON.parse(message.Body);
      this.logger.warn(`INTERRUPT received: ${interrupt.reason} (new thread: ${interrupt.newThreadId})`);

      // Emit interrupt event for the message processor to handle
      this.eventEmitter.emit('interrupt', interrupt);

      // The message processor should:
      // 1. Stop current processing
      // 2. Save state
      // 3. Send task failure/success with interrupted flag
      // 4. Start processing the new message

    } catch (error: any) {
      this.logger.error(`Failed to process interrupt: ${error.message}`);
    }
  }

  @SqsConsumerEventHandler('container-interrupts', 'error')
  async onError(error: Error, message: Message) {
    this.logger.error(`Error processing interrupt: ${error.message}`, error.stack);
  }

  /**
   * Create interrupt queue configuration
   * This should be called during container startup
   */
  getInterruptQueueConfig() {
    return {
      name: 'container-interrupts',
      queueUrl: `https://sqs.${process.env.AWS_REGION || 'us-west-2'}.amazonaws.com/${process.env.AWS_ACCOUNT_ID || '942734823970'}/${this.getInterruptQueueName()}`,
      region: process.env.AWS_REGION || 'us-west-2',
      pollingWaitTimeMs: 1000, // Poll every second for fast interrupts
      visibilityTimeout: 30, // Short timeout for interrupt messages
      messageAttributeNames: ['All'],
    };
  }

  /**
   * Get container metadata for registration
   */
  getContainerMetadata() {
    return {
      containerId: this.containerId,
      interruptQueueName: this.getInterruptQueueName(),
      startTime: new Date().toISOString(),
      region: process.env.AWS_REGION || 'us-west-2',
    };
  }
}