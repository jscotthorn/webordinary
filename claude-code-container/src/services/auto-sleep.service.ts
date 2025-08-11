import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DynamoDBClient, UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { GitService } from './git.service';

@Injectable()
export class AutoSleepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoSleepService.name);
  private readonly dynamodb: DynamoDBClient;
  private lastActivity: number = Date.now();
  private idleCheckInterval?: NodeJS.Timeout;
  
  // Configuration
  private readonly IDLE_TIMEOUT = 20 * 60 * 1000; // 20 minutes
  private readonly CHECK_INTERVAL = 60 * 1000; // 1 minute
  private readonly containerId: string;

  constructor(private readonly gitService: GitService) {
    this.dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-west-2' });
    
    // Build container ID from environment variables
    const clientId = process.env.DEFAULT_CLIENT_ID || 'unknown';
    const userId = process.env.DEFAULT_USER_ID || 'unknown';
    const threadId = process.env.THREAD_ID || 'unknown';
    this.containerId = `${clientId}-${threadId}-${userId}`;
    
    this.logger.log(`AutoSleep initialized for container: ${this.containerId}`);
  }

  async onModuleInit() {
    await this.initializeContainer();
    this.start();
  }

  async onModuleDestroy() {
    this.stop();
  }

  /**
   * Initialize container in DynamoDB with 'running' status
   */
  private async initializeContainer() {
    try {
      const now = Date.now();
      
      await this.dynamodb.send(new UpdateItemCommand({
        TableName: 'webordinary-containers',
        Key: { containerId: { S: this.containerId } },
        UpdateExpression: `
          SET #status = :status, 
              lastActivity = :now, 
              lastStarted = :now,
              containerIp = if_not_exists(containerIp, :ip),
              taskArn = if_not_exists(taskArn, :taskArn)
        `,
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': { S: 'running' },
          ':now': { N: now.toString() },
          ':ip': { S: process.env.CONTAINER_IP || 'unknown' },
          ':taskArn': { S: process.env.TASK_ARN || 'unknown' }
        }
      }));
      
      this.logger.log('Container registered as running in DynamoDB');
    } catch (error) {
      this.logger.error('Failed to initialize container in DynamoDB:', error);
    }
  }

  /**
   * Start the auto-sleep monitoring
   */
  start() {
    if (this.idleCheckInterval) {
      return; // Already started
    }

    this.logger.log('Starting auto-sleep monitor');
    
    // Check for idle state every minute
    this.idleCheckInterval = setInterval(async () => {
      await this.checkIdleState();
    }, this.CHECK_INTERVAL);
  }

  /**
   * Stop the auto-sleep monitoring
   */
  stop() {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = undefined;
      this.logger.log('Auto-sleep monitor stopped');
    }
  }

  /**
   * Record activity to reset the idle timer
   */
  recordActivity(source?: string) {
    const previousActivity = this.lastActivity;
    this.lastActivity = Date.now();
    
    if (source) {
      this.logger.debug(`Activity recorded from ${source}`);
    }
    
    // Only update DynamoDB if it's been more than 1 minute since last update
    if (this.lastActivity - previousActivity > 60000) {
      this.updateContainerActivity();
    }
  }

  /**
   * Check if the container should go idle or sleep
   */
  private async checkIdleState() {
    const idleTime = Date.now() - this.lastActivity;
    
    if (idleTime > this.IDLE_TIMEOUT) {
      this.logger.log(`Container idle for ${Math.round(idleTime / 60000)} minutes, checking sessions...`);
      
      // Check if any sessions are active for this container
      const activeSessions = await this.getActiveSessions();
      
      if (activeSessions === 0) {
        this.logger.log('No active sessions, initiating graceful shutdown...');
        await this.initiateShutdown();
      } else {
        this.logger.log(`${activeSessions} active sessions found, staying alive`);
        
        // Reset activity since there are active sessions
        this.recordActivity('active-sessions-found');
      }
    } else {
      const remainingMinutes = Math.round((this.IDLE_TIMEOUT - idleTime) / 60000);
      this.logger.debug(`Container active, ${remainingMinutes} minutes until idle check`);
    }
  }

  /**
   * Get the count of active sessions for this container
   */
  private async getActiveSessions(): Promise<number> {
    try {
      // Query thread mappings for this container
      const result = await this.dynamodb.send(new QueryCommand({
        TableName: 'webordinary-thread-mappings',
        IndexName: 'container-index', // Assumes we have a GSI on containerId
        KeyConditionExpression: 'containerId = :cid',
        ExpressionAttributeValues: {
          ':cid': { S: this.containerId }
        },
        Select: 'COUNT'
      }));
      
      return result.Count || 0;
    } catch (error) {
      this.logger.error('Error counting active sessions:', error);
      
      // If we can't check sessions, assume there are some to be safe
      return 1;
    }
  }

  /**
   * Initiate graceful shutdown of the container
   */
  private async initiateShutdown() {
    try {
      this.logger.log('Starting graceful shutdown sequence...');
      
      // Update container status to 'stopping'
      await this.dynamodb.send(new UpdateItemCommand({
        TableName: 'webordinary-containers',
        Key: { containerId: { S: this.containerId } },
        UpdateExpression: 'SET #status = :status, stoppedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': { S: 'stopping' },
          ':now': { N: Date.now().toString() }
        }
      }));
      
      // Save any uncommitted work
      await this.saveUncommittedWork();
      
      this.logger.log('Graceful shutdown complete, exiting...');
      
      // Stop the auto-sleep monitor
      this.stop();
      
      // Exit the process - ECS will handle task cleanup
      process.exit(0);
      
    } catch (error) {
      this.logger.error('Error during graceful shutdown:', error);
      
      // Force exit if graceful shutdown fails
      process.exit(1);
    }
  }

  /**
   * Save any uncommitted work before shutdown
   */
  private async saveUncommittedWork() {
    try {
      const workspacePath = process.env.WORKSPACE_PATH || '/workspace';
      
      this.logger.log('Checking for uncommitted changes...');
      
      const hasChanges = await this.gitService.hasUncommittedChanges(workspacePath);
      
      if (hasChanges) {
        this.logger.log('Saving uncommitted work...');
        
        // Stage all changes
        await this.gitService.stageChanges(workspacePath, '.');
        
        // Commit with auto-save message
        const commitMessage = `Auto-save: Container sleeping at ${new Date().toISOString()}`;
        await this.gitService.commit(workspacePath, commitMessage);
        
        // Push changes
        await this.gitService.push(workspacePath);
        
        this.logger.log('Uncommitted work saved and pushed');
      } else {
        this.logger.log('No uncommitted changes to save');
      }
    } catch (error) {
      this.logger.error('Failed to save uncommitted work:', error);
      
      // Don't fail the shutdown process due to save errors
      // The work will be preserved in the EFS volume
    }
  }

  /**
   * Update container activity timestamp in DynamoDB
   */
  private async updateContainerActivity() {
    try {
      await this.dynamodb.send(new UpdateItemCommand({
        TableName: 'webordinary-containers',
        Key: { containerId: { S: this.containerId } },
        UpdateExpression: 'SET lastActivity = :now',
        ExpressionAttributeValues: {
          ':now': { N: Date.now().toString() }
        }
      }));
      
      this.logger.debug('Container activity updated in DynamoDB');
    } catch (error) {
      this.logger.error('Failed to update container activity:', error);
    }
  }

  /**
   * Get current idle time in milliseconds
   */
  getIdleTime(): number {
    return Date.now() - this.lastActivity;
  }

  /**
   * Get container status for health checks
   */
  getStatus() {
    const idleTime = this.getIdleTime();
    const isIdle = idleTime > this.IDLE_TIMEOUT;
    
    return {
      containerId: this.containerId,
      lastActivity: new Date(this.lastActivity).toISOString(),
      idleTime: Math.round(idleTime / 1000), // seconds
      isIdle,
      status: isIdle ? 'idle' : 'active',
      timeUntilSleep: isIdle ? 0 : Math.round((this.IDLE_TIMEOUT - idleTime) / 1000)
    };
  }
}