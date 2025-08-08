import { spawn, ChildProcess } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import fetch from 'node-fetch';

export class AstroManager {
  private process: ChildProcess | null = null;
  private wsProxy: WebSocketServer | null = null;
  private projectPath: string;
  private isDevServer = false;
  
  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }
  
  /**
   * Start Astro dev server with HMR support
   */
  async start(): Promise<void> {
    console.log(`Starting Astro dev server in ${this.projectPath}`);
    
    // Check if this is an Astro project
    const astroConfig = path.join(this.projectPath, 'astro.config.mjs');
    const packageJson = path.join(this.projectPath, 'package.json');
    
    if (!(await this.pathExists(astroConfig)) && !(await this.pathExists(packageJson))) {
      throw new Error('Not an Astro project - missing astro.config.mjs and package.json');
    }
    
    // Check if node_modules exists (skip install if cached)
    const modulesExist = await this.pathExists(`${this.projectPath}/node_modules`);
    
    if (!modulesExist) {
      console.log('First run - installing dependencies...');
      await this.runCommand('npm', ['install'], this.projectPath);
    } else {
      console.log('Using cached node_modules');
    }
    
    // Kill any existing process
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    
    // Start Astro dev server
    this.process = spawn('npm', ['run', 'dev'], {
      cwd: this.projectPath,
      env: {
        ...process.env,
        HOST: '0.0.0.0',
        PORT: '4321',
        ASTRO_TELEMETRY_DISABLED: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    this.isDevServer = true;
    
    // Log output for debugging
    this.process.stdout?.on('data', (data) => {
      console.log(`Astro stdout: ${data}`);
    });
    
    this.process.stderr?.on('data', (data) => {
      console.error(`Astro stderr: ${data}`);
    });
    
    this.process.on('exit', (code) => {
      console.log(`Astro dev server exited with code ${code}`);
      this.process = null;
      this.isDevServer = false;
    });
    
    // Set up WebSocket proxy for HMR
    await this.setupWebSocketProxy();
    
    // Wait for server to be ready
    await this.waitForReady();
    
    console.log('Astro dev server started successfully');
  }
  
  /**
   * Stop the Astro dev server
   */
  async stop(): Promise<void> {
    if (this.process) {
      console.log('Stopping Astro dev server...');
      this.process.kill('SIGTERM');
      
      // Wait for graceful shutdown
      await new Promise((resolve) => {
        if (this.process) {
          this.process.on('exit', resolve);
          
          // Force kill after 5 seconds
          setTimeout(() => {
            if (this.process) {
              this.process.kill('SIGKILL');
            }
            resolve(undefined);
          }, 5000);
        } else {
          resolve(undefined);
        }
      });
      
      this.process = null;
      this.isDevServer = false;
    }
    
    // Close WebSocket proxy
    if (this.wsProxy) {
      this.wsProxy.close();
      this.wsProxy = null;
    }
  }
  
  /**
   * Check if Astro dev server is running
   */
  isRunning(): boolean {
    return this.process !== null && this.isDevServer;
  }
  
  /**
   * Get the dev server URL
   */
  getUrl(): string {
    return 'http://localhost:4321';
  }
  
  /**
   * Get the WebSocket proxy URL for HMR
   */
  getWebSocketUrl(): string {
    return 'ws://localhost:4322';
  }
  
  /**
   * Build the Astro project for production
   */
  async build(): Promise<void> {
    console.log(`Building Astro project in ${this.projectPath}`);
    await this.runCommand('npm', ['run', 'build'], this.projectPath);
  }
  
  /**
   * Preview the built Astro project
   */
  async preview(): Promise<void> {
    console.log(`Starting Astro preview in ${this.projectPath}`);
    
    // Kill any existing process first
    if (this.process) {
      this.process.kill('SIGTERM');
    }
    
    this.process = spawn('npm', ['run', 'preview'], {
      cwd: this.projectPath,
      env: {
        ...process.env,
        HOST: '0.0.0.0',
        PORT: '4321'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    this.isDevServer = false;
    
    // Log output
    this.process.stdout?.on('data', (data) => {
      console.log(`Astro preview stdout: ${data}`);
    });
    
    this.process.stderr?.on('data', (data) => {
      console.error(`Astro preview stderr: ${data}`);
    });
    
    // Wait for preview to be ready
    await this.waitForReady();
  }
  
  /**
   * Setup WebSocket proxy for HMR connections
   */
  private async setupWebSocketProxy(): Promise<void> {
    if (this.wsProxy) {
      this.wsProxy.close();
    }
    
    this.wsProxy = new WebSocketServer({ port: 4322 });
    
    this.wsProxy.on('connection', (ws) => {
      console.log('WebSocket proxy connection established');
      
      // Connect to Astro's HMR WebSocket
      const astroWs = new WebSocket('ws://localhost:4321/_astro');
      
      // Forward messages between client and Astro
      ws.on('message', (data) => {
        if (astroWs.readyState === WebSocket.OPEN) {
          astroWs.send(data);
        }
      });
      
      astroWs.on('message', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });
      
      // Handle connection cleanup
      ws.on('close', () => {
        astroWs.close();
      });
      
      astroWs.on('close', () => {
        ws.close();
      });
      
      astroWs.on('error', (error) => {
        console.error('Astro WebSocket error:', error);
        ws.close();
      });
    });
    
    console.log('WebSocket proxy listening on port 4322');
  }
  
  /**
   * Wait for Astro server to be ready
   */
  private async waitForReady(timeout = 30000): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      try {
        const response = await fetch('http://localhost:4321');
        
        if (response.ok) {
          console.log('Astro server is ready');
          return;
        }
      } catch (e) {
        // Server not ready yet
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error(`Astro server failed to start within ${timeout}ms`);
  }
  
  /**
   * Run a command and wait for it to complete
   */
  private async runCommand(command: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout?.on('data', (data) => {
        stdout += data;
        console.log(`${command} stdout: ${data}`);
      });
      
      child.stderr?.on('data', (data) => {
        stderr += data;
        console.error(`${command} stderr: ${data}`);
      });
      
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${command} exited with code ${code}\nStderr: ${stderr}`));
        }
      });
      
      child.on('error', (error) => {
        reject(error);
      });
    });
  }
  
  /**
   * Check if a path exists
   */
  private async pathExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}