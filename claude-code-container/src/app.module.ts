import { Module } from '@nestjs/common';
import { SqsModule } from '@ssut/nestjs-sqs';
// Removed AWS SDK v2 - using v3 in services
import { MessageProcessor } from './message-processor.service';
import { ClaudeExecutorService } from './services/claude-executor.service';
import { GitService } from './services/git.service';
import { S3SyncService } from './services/s3-sync.service';
import { CommitMessageService } from './services/commit-message.service';

@Module({
  imports: [
    SqsModule.register({
      consumers: process.env.INPUT_QUEUE_URL ? [
        {
          name: 'container-input',
          queueUrl: process.env.INPUT_QUEUE_URL,
          region: process.env.AWS_REGION || 'us-west-2',
          batchSize: 1,
          visibilityTimeout: 300,
          waitTimeSeconds: 20,
        },
      ] : [],
      producers: process.env.OUTPUT_QUEUE_URL ? [
        {
          name: 'container-output',
          queueUrl: process.env.OUTPUT_QUEUE_URL,
          region: process.env.AWS_REGION || 'us-west-2',
        },
      ] : [],
    }),
  ],
  providers: [
    MessageProcessor,
    ClaudeExecutorService,
    GitService,
    S3SyncService,
    CommitMessageService,
  ],
})
export class AppModule {}