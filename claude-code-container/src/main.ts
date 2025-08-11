import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { GitService } from './services/git.service';
import { S3SyncService } from './services/s3-sync.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  // Create NestJS application context (no HTTP server needed)
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // Get services
  const gitService = app.get(GitService);
  const s3SyncService = app.get(S3SyncService);

  // Initialize git repository if needed
  const repoUrl = process.env.REPO_URL;
  if (repoUrl) {
    logger.log(`Initializing repository from ${repoUrl}`);
    await gitService.initRepository(repoUrl);
  }

  // Check AWS CLI availability
  const hasAwsCli = await s3SyncService.checkAwsCli();
  if (!hasAwsCli) {
    logger.error('AWS CLI not found - S3 sync will not work');
  } else {
    logger.log('AWS CLI available for S3 sync');
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.log('Shutting down gracefully...');
    
    // Close NestJS app
    await app.close();
    
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Log startup information
  logger.log('Container started successfully');
  logger.log(`- Client: ${process.env.CLIENT_ID || 'amelia'}`);
  logger.log(`- Workspace: ${process.env.WORKSPACE_PATH || '/workspace'}`);
  logger.log(`- S3 Bucket: ${s3SyncService.getDeployedUrl()}`);
  logger.log('- Ready to process messages, build, and deploy to S3');
  
  if (process.env.INPUT_QUEUE_URL) {
    logger.log(`- Processing SQS messages from ${process.env.INPUT_QUEUE_URL}`);
  } else {
    logger.warn('- No INPUT_QUEUE_URL provided, SQS polling disabled');
  }
  
  if (process.env.OUTPUT_QUEUE_URL) {
    logger.log(`- Sending responses to ${process.env.OUTPUT_QUEUE_URL}`);
  } else {
    logger.warn('- No OUTPUT_QUEUE_URL provided, response sending disabled');
  }
}

bootstrap().catch((err) => {
  console.error('Failed to start container:', err);
  process.exit(1);
});