import { Module } from '@nestjs/common';
import { SqsModule } from '@ssut/nestjs-sqs';
import * as AWS from 'aws-sdk';
import { MessageProcessor } from './message-processor.service';
import { ClaudeExecutorService } from './services/claude-executor.service';
import { GitService } from './services/git.service';
import { AstroService } from './services/astro.service';

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
    AstroService,
  ],
})
export class AppModule {}