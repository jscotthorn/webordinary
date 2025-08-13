import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { QueueManagerService } from './queue-manager.service';

const execAsync = promisify(exec);

@Injectable()
export class S3SyncService {
  private readonly logger = new Logger(S3SyncService.name);
  private readonly workspacePath: string;

  constructor(
    @Inject(forwardRef(() => require('./queue-manager.service').QueueManagerService))
    private readonly queueManager: QueueManagerService,
  ) {
    this.workspacePath = process.env.WORKSPACE_PATH || '/workspace';
  }

  private getProjectPath(): string {
    const claim = this.queueManager.getCurrentClaim();
    if (!claim) {
      // Fallback for legacy tests or initialization
      return path.join(this.workspacePath, 'unclaimed', 'workspace', 'amelia-astro');
    }
    const { projectId, userId } = claim;
    return path.join(this.workspacePath, projectId, userId, 'amelia-astro');
  }

  /**
   * Build the Astro project
   */
  async buildAstroProject(): Promise<void> {
    this.logger.log('Building Astro project...');
    const projectPath = this.getProjectPath();
    
    try {
      const { stdout, stderr } = await execAsync('npm run build', {
        cwd: projectPath,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      if (stderr && !stderr.includes('warning')) {
        this.logger.warn(`Build stderr: ${stderr}`);
      }

      this.logger.log('Astro build completed successfully');
      this.logger.debug(stdout);
    } catch (error: any) {
      this.logger.error(`Astro build failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Sync built files to S3
   */
  async syncToS3(clientId?: string): Promise<void> {
    // Use provided clientId or fall back to environment variable
    const bucketName = this.getBucketName(clientId);
    const projectPath = this.getProjectPath();
    const distPath = path.join(projectPath, 'dist');

    // Check if dist directory exists
    try {
      await fs.access(distPath);
    } catch {
      throw new Error(`Dist directory not found at ${distPath}. Run build first.`);
    }

    this.logger.log(`Syncing to S3 bucket: ${bucketName}`);
    
    try {
      // Use AWS CLI for sync (simpler than SDK for this use case)
      const cmd = `aws s3 sync ${distPath} s3://${bucketName} --delete --region ${process.env.AWS_REGION || 'us-west-2'}`;
      
      this.logger.debug(`Executing: ${cmd}`);
      
      const startTime = Date.now();
      const { stdout, stderr } = await execAsync(cmd, {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      if (stdout) {
        // Count uploaded files
        const uploadCount = (stdout.match(/upload:/g) || []).length;
        const deleteCount = (stdout.match(/delete:/g) || []).length;
        
        this.logger.log(`S3 sync completed in ${duration}s - ${uploadCount} files uploaded, ${deleteCount} deleted`);
        this.logger.debug(stdout);
      } else {
        this.logger.log(`S3 sync completed in ${duration}s - no changes`);
      }
      
      if (stderr && !stderr.includes('warning')) {
        this.logger.warn(`S3 sync stderr: ${stderr}`);
      }
    } catch (error: any) {
      this.logger.error(`S3 sync failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Build and deploy in one step
   */
  async buildAndDeploy(clientId?: string): Promise<void> {
    this.logger.log('Starting build and deploy process...');
    
    // Step 1: Build Astro
    await this.buildAstroProject();
    
    // Step 2: Sync to S3
    await this.syncToS3(clientId);
    
    this.logger.log('Build and deploy completed successfully');
  }

  /**
   * Get the S3 bucket name based on client ID
   */
  private getBucketName(clientId?: string): string {
    if (clientId) {
      return `edit.${clientId}.webordinary.com`;
    }
    const claim = this.queueManager.getCurrentClaim();
    const id = claim?.projectId || 'amelia';
    return `edit.${id}.webordinary.com`;
  }

  /**
   * Check if AWS CLI is available
   */
  async checkAwsCli(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('aws --version');
      this.logger.debug(`AWS CLI version: ${stdout.trim()}`);
      return true;
    } catch {
      this.logger.error('AWS CLI not found in container');
      return false;
    }
  }

  /**
   * Get the public URL for the deployed site
   */
  getDeployedUrl(clientId?: string): string {
    if (clientId) {
      return `https://edit.${clientId}.webordinary.com`;
    }
    const claim = this.queueManager.getCurrentClaim();
    const id = claim?.projectId || 'amelia';
    return `https://edit.${id}.webordinary.com`;
  }
}