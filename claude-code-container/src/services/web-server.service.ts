import { Injectable, Logger } from '@nestjs/common';
import express from 'express';
import * as path from 'path';
import { Server } from 'http';

@Injectable()
export class WebServerService {
  private readonly logger = new Logger(WebServerService.name);
  private server: Server | null = null;
  private readonly port: number = 8080;
  private readonly workspacePath: string;

  constructor() {
    this.workspacePath = process.env.WORKSPACE_PATH || '/workspace';
  }

  async start(): Promise<void> {
    if (this.server) {
      this.logger.warn('Web server is already running');
      return;
    }

    const app = express();

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        clientId: process.env.CLIENT_ID || 'amelia',
        version: '1.0.0'
      });
    });

    // API endpoints (for future use)
    app.use('/api', this.createApiRouter());

    // Serve Astro static files
    const distPath = path.join(this.workspacePath, 'dist', 'client');
    app.use('/static', express.static(distPath));
    
    // Serve Astro assets
    app.use('/_astro', express.static(path.join(distPath, '_astro')));

    // Handle session routes - serve the main index.html for all non-API routes
    app.get('/session/:sessionId/*?', (req, res) => {
      const indexPath = path.join(distPath, 'index.html');
      res.sendFile(indexPath, (err) => {
        if (err) {
          this.logger.error(`Failed to serve index.html: ${err.message}`);
          res.status(404).send(`
            <html>
              <head><title>Edit Session Not Ready</title></head>
              <body style="font-family: Arial, sans-serif; margin: 40px;">
                <h1>Edit Session Starting</h1>
                <p>The edit environment is still starting up. Please wait...</p>
                <p><em>If this persists, the Astro build may have failed.</em></p>
                <p>Session ID: ${req.params.sessionId}</p>
              </body>
            </html>
          `);
        }
      });
    });

    // Handle root requests
    app.get('/', (req, res) => {
      res.send(`
        <html>
          <head><title>Webordinary Edit Container</title></head>
          <body style="font-family: Arial, sans-serif; margin: 40px;">
            <h1>Webordinary Edit Container</h1>
            <p>This is the edit container for client: <strong>${process.env.CLIENT_ID || 'amelia'}</strong></p>
            <p>To access your edit session, use the URL format:</p>
            <code>/session/{sessionId}/</code>
            <hr>
            <small>Health check: <a href="/health">/health</a></small>
          </body>
        </html>
      `);
    });

    // Start the server
    return new Promise((resolve, reject) => {
      this.server = app.listen(this.port, '0.0.0.0', () => {
        this.logger.log(`Web server started on port ${this.port}`);
        this.logger.log(`Serving Astro static files from: ${distPath}`);
        resolve();
      }).on('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      this.logger.warn('Web server is not running');
      return;
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.logger.log('Web server stopped');
        this.server = null;
        resolve();
      });
    });
  }

  private createApiRouter(): express.Router {
    const apiRouter = express.Router();
    
    apiRouter.use(express.json());

    // Session management endpoints
    apiRouter.get('/session/:sessionId', (req, res) => {
      res.json({
        sessionId: req.params.sessionId,
        status: 'active',
        clientId: process.env.CLIENT_ID || 'amelia',
        timestamp: new Date().toISOString()
      });
    });

    // Claude Code execution endpoint (placeholder for future)
    apiRouter.post('/execute', (req, res) => {
      this.logger.log('Received execute request:', req.body);
      res.json({
        success: true,
        message: 'Command execution not implemented yet',
        timestamp: new Date().toISOString()
      });
    });

    return apiRouter;
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  getPort(): number {
    return this.port;
  }
}