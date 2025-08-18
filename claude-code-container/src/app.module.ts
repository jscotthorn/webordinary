import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SqsModule } from '@ssut/nestjs-sqs';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SQSClient } from '@aws-sdk/client-sqs';

// Services
import { ClaudeExecutorService } from './services/claude-executor.service';
import { GitService } from './services/git.service';
import { S3SyncService } from './services/s3-sync.service';
import { CommitMessageService } from './services/commit-message.service';
import { StepFunctionsCallbackService } from './services/stepfunctions-callback.service';
import { ActiveJobService } from './services/active-job.service';
import { VisibilityExtensionService } from './services/visibility-extension.service';
import { InterruptHandlerService } from './services/interrupt-handler.service';
import { MessageProcessor } from './services/message-processor.service';
import { GenericContainerService } from './services/generic-container.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EventEmitterModule.forRoot(),
    SqsModule.register({
      consumers: [
        {
          name: 'unclaimed-queue',
          queueUrl: process.env.UNCLAIMED_QUEUE_URL || 
            `https://sqs.${process.env.AWS_REGION || 'us-west-2'}.amazonaws.com/${process.env.AWS_ACCOUNT_ID || '942734823970'}/webordinary-unclaimed`,
          region: process.env.AWS_REGION || 'us-west-2',
          pollingWaitTimeMs: 20000, // Long polling
          visibilityTimeout: 30, // Short timeout for claim requests
          messageAttributeNames: ['All'],
          attributeNames: ['All'],
          shouldDeleteMessages: true, // Auto-delete on success
          sqs: new SQSClient({
            region: process.env.AWS_REGION || 'us-west-2',
          }),
        },
        // Project-specific queues will be polled dynamically after claiming
      ],
      producers: [],
    }),
  ],
  providers: [
    ClaudeExecutorService,
    GitService,
    S3SyncService,
    CommitMessageService,
    StepFunctionsCallbackService,
    ActiveJobService,
    VisibilityExtensionService,
    InterruptHandlerService,
    MessageProcessor,
    GenericContainerService,
  ],
})
export class AppModule {
  constructor(private interruptHandler: InterruptHandlerService) {
    // Log container metadata on startup
    const metadata = this.interruptHandler.getContainerMetadata();
    console.log('Container started with metadata:', metadata);
    
    // TODO: Register interrupt queue dynamically
    // This would require creating the queue if it doesn't exist
    // and adding it to the SQS consumers at runtime
    console.log(`Interrupt queue: ${metadata.interruptQueueName}`);
  }
}