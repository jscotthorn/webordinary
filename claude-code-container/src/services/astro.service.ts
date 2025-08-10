import { Injectable, Logger } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Injectable()
export class AstroService {
  private readonly logger = new Logger(AstroService.name);
  private astroProcess: ChildProcess | null = null;
  private readonly workspacePath: string;
  private readonly port: number;

  constructor() {
    this.workspacePath = process.env.WORKSPACE_PATH || '/workspace';
    this.port = parseInt(process.env.ASTRO_PORT || '4321', 10);
  }

  async start(): Promise<void> {
    if (this.astroProcess) {
      this.logger.warn('Astro dev server is already running');
      return;
    }

    this.logger.log('Starting Astro dev server...');
    
    this.astroProcess = spawn('npm', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', this.port.toString()], {
      cwd: this.workspacePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: this.port.toString(),
      },
    });

    // Log Astro output
    this.astroProcess.stdout?.on('data', (data) => {
      this.logger.debug(`Astro: ${data.toString().trim()}`);
    });

    this.astroProcess.stderr?.on('data', (data) => {
      this.logger.warn(`Astro stderr: ${data.toString().trim()}`);
    });

    this.astroProcess.on('exit', (code) => {
      this.logger.log(`Astro dev server exited with code ${code}`);
      this.astroProcess = null;
    });

    // Wait for server to be ready
    await this.waitForServer();
  }

  async stop(): Promise<void> {
    if (!this.astroProcess) {
      this.logger.warn('Astro dev server is not running');
      return;
    }

    this.logger.log('Stopping Astro dev server...');
    
    return new Promise((resolve) => {
      if (!this.astroProcess) {
        resolve();
        return;
      }

      this.astroProcess.once('exit', () => {
        this.astroProcess = null;
        resolve();
      });

      this.astroProcess.kill('SIGTERM');
      
      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.astroProcess) {
          this.astroProcess.kill('SIGKILL');
        }
      }, 5000);
    });
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async build(): Promise<void> {
    this.logger.log('Building Astro project...');
    
    try {
      const { stdout, stderr } = await execAsync('npm run build', {
        cwd: this.workspacePath,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      if (stderr) {
        this.logger.warn(`Build stderr: ${stderr}`);
      }

      this.logger.log('Astro build completed successfully');
      this.logger.debug(stdout);
    } catch (error: any) {
      this.logger.error(`Astro build failed: ${error.message}`);
      throw error;
    }
  }

  isRunning(): boolean {
    return this.astroProcess !== null && !this.astroProcess.killed;
  }

  getUrl(): string {
    return `http://localhost:${this.port}`;
  }

  getWebSocketUrl(): string {
    return `ws://localhost:${this.port}`;
  }

  private async waitForServer(maxAttempts: number = 30): Promise<void> {
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    
    for (let i = 0; i < maxAttempts; i++) {
      try {
        // Try to connect to the server
        const response = await fetch(`http://localhost:${this.port}`);
        if (response.ok || response.status === 404) {
          this.logger.log(`Astro dev server ready on port ${this.port}`);
          return;
        }
      } catch {
        // Server not ready yet
      }
      
      await delay(1000);
    }
    
    throw new Error(`Astro dev server failed to start after ${maxAttempts} seconds`);
  }
}