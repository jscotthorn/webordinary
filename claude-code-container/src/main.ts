import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { AstroService } from './services/astro.service';
import { GitService } from './services/git.service';
import { WebServerService } from './services/web-server.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  // Create NestJS application context (no HTTP server needed)
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // Get services
  const astroService = app.get(AstroService);
  const gitService = app.get(GitService);
  const webServerService = app.get(WebServerService);

  // Initialize git repository if needed
  const repoUrl = process.env.REPO_URL;
  if (repoUrl) {
    logger.log(`Initializing repository from ${repoUrl}`);
    await gitService.initRepository(repoUrl);
  }

  // Build Astro project to static files
  logger.log('Building Astro project...');
  await astroService.build();

  // Start web server (serves static Astro files + API)
  logger.log('Starting web server...');
  await webServerService.start();

  // Graceful shutdown
  const shutdown = async () => {
    logger.log('Shutting down gracefully...');
    
    // Stop web server
    await webServerService.stop();
    
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
  logger.log(`- Web server on port ${webServerService.getPort()}`);
  logger.log(`- Static Astro files served from build`);
  
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