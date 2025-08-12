import { Module } from '@nestjs/common';
import { SqsModule } from '@ssut/nestjs-sqs';
// Removed AWS SDK v2 - using v3 in services
import { MessageProcessor } from './message-processor.service';
import { ClaudeExecutorService } from './services/claude-executor.service';
import { GitService } from './services/git.service';
import { S3SyncService } from './services/s3-sync.service';
import { CommitMessageService } from './services/commit-message.service';
import { QueueManagerService } from './services/queue-manager.service';

@Module({
  imports: [
    // Note: SqsModule consumers/producers will be registered dynamically
    // by QueueManagerService after claiming a project
    SqsModule.register({
      consumers: [],
      producers: [],
    }),
  ],
  providers: [
    MessageProcessor,
    ClaudeExecutorService,
    GitService,
    S3SyncService,
    CommitMessageService,
    QueueManagerService,
  ],
  exports: [
    QueueManagerService,
    GitService,
    S3SyncService,
  ],
})
export class AppModule {}