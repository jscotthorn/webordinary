import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Create NestJS application context (no HTTP server needed)
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // Graceful shutdown handlers
  const shutdown = async () => {
    logger.log('Shutting down gracefully...');
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Log startup information
  logger.log('Generic container started with Step Functions integration');
  logger.log(`- Workspace: ${process.env.WORKSPACE_PATH || '/workspace'}`);
  logger.log(`- Region: ${process.env.AWS_REGION || 'us-west-2'}`);
  logger.log(`- Account: ${process.env.AWS_ACCOUNT_ID || '942734823970'}`);
  logger.log(`- Unclaimed Queue: ${process.env.UNCLAIMED_QUEUE_URL || 'webordinary-unclaimed'}`);
  logger.log(`- Ownership Table: ${process.env.OWNERSHIP_TABLE_NAME || 'webordinary-container-ownership'}`);
  logger.log(`- Active Jobs Table: ${process.env.ACTIVE_JOBS_TABLE || 'webordinary-active-jobs'}`);
  
  logger.log('');
  logger.log('Container is now polling the unclaimed queue for work...');
  logger.log('When a project+user is claimed, it will poll their specific FIFO queue.');
  logger.log('Container will release ownership after 5 minutes of inactivity.');
  
  if (process.env.CONTAINER_ID) {
    logger.log(`- Container ID (override): ${process.env.CONTAINER_ID}`);
  }
}

bootstrap().catch((err) => {
  console.error('Failed to start container:', err);
  process.exit(1);
});