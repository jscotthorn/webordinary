import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { GitService } from './services/git.service';
import { S3SyncService } from './services/s3-sync.service';
import { QueueManagerService } from './services/queue-manager.service';
import { MessageProcessor } from './message-processor.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  // Create NestJS application context (no HTTP server needed)
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // Get services
  const gitService = app.get(GitService);
  const s3SyncService = app.get(S3SyncService);
  const queueManager = app.get(QueueManagerService);
  const messageProcessor = app.get(MessageProcessor);

  // Repository initialization removed - will be handled per message
  // Containers are now generic and claim work dynamically
  // Repository URL comes from work messages, not environment

  // Check AWS CLI availability
  const hasAwsCli = await s3SyncService.checkAwsCli();
  if (!hasAwsCli) {
    logger.error('AWS CLI not found - S3 sync will not work');
  } else {
    logger.log('AWS CLI available for S3 sync');
  }

  // Initialize queue manager for claiming projects
  logger.log('Initializing queue manager...');
  await queueManager.initialize();
  
  // Set up message processing when queue manager receives messages
  queueManager.on('message', async (messageData: any) => {
    logger.log(`Processing message from claimed project queue`);
    try {
      // Process the message using existing message processor
      await messageProcessor.handleMessage({
        Body: JSON.stringify(messageData.body),
        ReceiptHandle: messageData.receiptHandle,
      } as any);
    } catch (error: any) {
      logger.error(`Failed to process message: ${error.message}`);
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.log('Shutting down gracefully...');
    
    // Shutdown queue manager
    await queueManager.shutdown();
    
    // Close NestJS app
    await app.close();
    
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Log startup information
  logger.log('Container started successfully');
  logger.log(`- Workspace: ${process.env.WORKSPACE_PATH || '/workspace'}`);
  logger.log('- Ready to claim projects and process messages');
  
  if (process.env.UNCLAIMED_QUEUE_URL) {
    logger.log(`- Monitoring unclaimed queue: ${process.env.UNCLAIMED_QUEUE_URL}`);
  } else {
    logger.warn('- No UNCLAIMED_QUEUE_URL provided, waiting for environment update');
  }
  
  if (process.env.OWNERSHIP_TABLE_NAME) {
    logger.log(`- Using ownership table: ${process.env.OWNERSHIP_TABLE_NAME}`);
  } else {
    logger.log('- Using default ownership table: webordinary-container-ownership');
  }
  
  // Keep the process alive for health checks
  // Queue manager will keep polling
  setInterval(() => {
    const project = queueManager.getCurrentProject();
    if (project) {
      logger.debug(`Container heartbeat - serving project: ${project}`);
    } else {
      logger.debug('Container heartbeat - waiting for project claim...');
    }
  }, 60000); // Log every minute to show we're alive
}

bootstrap().catch((err) => {
  console.error('Failed to start container:', err);
  process.exit(1);
});