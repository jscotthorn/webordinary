import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface WorkspaceInfo {
  userPath: string;
  projectPath: string;
  claudePath: string;
  branch: string;
  resumed: boolean;
}

interface UserMetadata {
  created: string;
  repoUrl?: string;
  lastAccessed?: string;
}

interface ThreadContext {
  history: any[];
  plans: any[];
  threadId: string;
  branch: string;
}

interface GitConfig {
  autoPush: boolean;
  defaultBranch: string;
  protectedBranches: string[];
  remoteName: string;
}

interface GitStatus {
  branch: string;
  clean: boolean;
  ahead: number;
  behind: number;
  changes: GitChanges;
  canPush: boolean;
}

interface GitChanges {
  added: string[];
  modified: string[];
  deleted: string[];
  untracked: string[];
}

interface PushResult {
  success: boolean;
  branch: string;
  prUrl?: string;
  commits?: string[];
  error?: string;
}

interface CommitResult {
  success: boolean;
  commitHash?: string;
  branch: string;
  pushed: boolean;
  prUrl?: string;
  message?: string;
}

export class ThreadManager {
  private baseDir = '/workspace';
  private gitConfig: GitConfig;
  
  constructor() {
    this.gitConfig = {
      autoPush: process.env.GIT_AUTO_PUSH === 'true',
      defaultBranch: process.env.GIT_DEFAULT_BRANCH || 'main',
      protectedBranches: (process.env.GIT_PROTECTED_BRANCHES || 'main,master,production').split(','),
      remoteName: process.env.GIT_REMOTE || 'origin',
    };
  }
  
  /**
   * Initialize workspace for a specific client/user/thread combination
   */
  async initializeWorkspace(
    clientId: string, 
    userId: string, 
    threadId: string, 
    repoUrl?: string
  ): Promise<WorkspaceInfo> {
    const userPath = path.join(this.baseDir, clientId, userId);
    const projectPath = path.join(userPath, 'project');
    const claudePath = path.join(userPath, '.claude');
    const threadsPath = path.join(claudePath, 'threads');
    
    // Check if user workspace exists
    const userExists = await this.pathExists(userPath);
    
    if (!userExists) {
      // First time for this user - create workspace and clone
      console.log(`Creating workspace for ${clientId}/${userId}`);
      await fs.mkdir(userPath, { recursive: true });
      await fs.mkdir(claudePath, { recursive: true });
      await fs.mkdir(threadsPath, { recursive: true });
      
      if (repoUrl) {
        console.log(`Cloning repository to ${projectPath}`);
        
        // Configure git credentials for this session
        await this.setupGitCredentials();
        
        // For GitHub repos, inject the token directly into the URL
        let cloneUrl = repoUrl;
        if (repoUrl.includes('github.com') && process.env.GITHUB_TOKEN) {
          // Convert SSH to HTTPS if needed
          if (repoUrl.startsWith('git@github.com:')) {
            cloneUrl = repoUrl.replace('git@github.com:', 'https://github.com/').replace('.git', '');
          }
          // Inject token into HTTPS URL
          if (cloneUrl.startsWith('https://github.com/')) {
            cloneUrl = cloneUrl.replace('https://github.com/', `https://${process.env.GITHUB_TOKEN}@github.com/`);
          }
        }
        
        console.log(`Cloning from: ${cloneUrl.replace(process.env.GITHUB_TOKEN || '', '***')}`);
        
        try {
          await execAsync(`git clone ${cloneUrl} ${projectPath}`);
          
          // Mark the cloned directory as safe to avoid ownership issues
          await execAsync(`git config --global --add safe.directory ${projectPath}`);
        } catch (error: any) {
          console.error('Clone failed:', error.message);
          throw new Error(`Failed to clone repository: ${error.message}`);
        }
        
        // Install dependencies if package.json exists
        const packageJsonPath = path.join(projectPath, 'package.json');
        if (await this.pathExists(packageJsonPath)) {
          console.log('Installing npm dependencies...');
          await execAsync(`cd ${projectPath} && npm install`);
        }
      } else {
        await fs.mkdir(projectPath, { recursive: true });
      }
      
      await this.saveUserMetadata(clientId, userId, {
        created: new Date().toISOString(),
        repoUrl
      });
    }
    
    // Ensure the project directory is marked as safe
    if (await this.pathExists(projectPath)) {
      await execAsync(`git config --global --add safe.directory ${projectPath}`);
    }
    
    // Switch to thread branch
    const branch = `thread-${threadId}`;
    const branchExists = await this.branchExists(projectPath, branch);
    
    if (branchExists) {
      console.log(`Switching to existing branch: ${branch}`);
      await execAsync(`cd ${projectPath} && git checkout ${branch}`);
    } else {
      console.log(`Creating new branch: ${branch}`);
      await execAsync(`cd ${projectPath} && git checkout -b ${branch}`);
    }
    
    return {
      userPath,
      projectPath,
      claudePath,
      branch,
      resumed: branchExists
    };
  }
  
  /**
   * Switch to a specific thread branch
   */
  async switchToThread(clientId: string, userId: string, threadId: string): Promise<WorkspaceInfo> {
    const userPath = path.join(this.baseDir, clientId, userId);
    const projectPath = path.join(userPath, 'project');
    const claudePath = path.join(userPath, '.claude');
    const branch = `thread-${threadId}`;
    
    // Stash any uncommitted changes first
    try {
      await execAsync(`cd ${projectPath} && git stash push -m "auto-stash-${new Date().toISOString()}"`);
    } catch (e) {
      // No changes to stash
      console.log('No changes to stash');
    }
    
    // Switch branch
    await execAsync(`cd ${projectPath} && git checkout ${branch}`);
    
    return {
      userPath,
      projectPath,
      claudePath,
      branch,
      resumed: true
    };
  }
  
  /**
   * Commit changes to the current thread branch
   */
  async commitChanges(projectPath: string, message: string): Promise<void> {
    try {
      // Check if there are any changes
      const { stdout } = await execAsync(`cd ${projectPath} && git status --porcelain`);
      
      if (stdout.trim()) {
        await execAsync(`cd ${projectPath} && git add -A`);
        await execAsync(`cd ${projectPath} && git commit -m "${message}"`);
        console.log(`Committed changes: ${message}`);
      } else {
        console.log('No changes to commit');
      }
    } catch (error) {
      console.error('Error committing changes:', error);
    }
  }
  
  /**
   * Load thread context from persistent storage
   */
  async loadThreadContext(clientId: string, userId: string, threadId: string): Promise<ThreadContext> {
    const threadPath = path.join(this.baseDir, clientId, userId, '.claude', 'threads', `${threadId}.json`);
    
    if (await this.pathExists(threadPath)) {
      try {
        const content = await fs.readFile(threadPath, 'utf-8');
        return JSON.parse(content);
      } catch (error) {
        console.error('Error loading thread context:', error);
      }
    }
    
    return {
      history: [],
      plans: [],
      threadId,
      branch: `thread-${threadId}`
    };
  }
  
  /**
   * Save thread context to persistent storage
   */
  async saveThreadContext(
    clientId: string, 
    userId: string, 
    threadId: string, 
    context: any
  ): Promise<void> {
    const threadPath = path.join(this.baseDir, clientId, userId, '.claude', 'threads', `${threadId}.json`);
    
    // Ensure threads directory exists
    await fs.mkdir(path.dirname(threadPath), { recursive: true });
    
    try {
      await fs.writeFile(threadPath, JSON.stringify(context, null, 2));
      console.log(`Saved thread context for ${threadId}`);
      
      // Update last accessed time
      await this.updateUserLastAccessed(clientId, userId);
    } catch (error) {
      console.error('Error saving thread context:', error);
    }
  }
  
  /**
   * Get git status for a project
   */
  async getGitStatus(projectPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`cd ${projectPath} && git status --short`);
      return stdout;
    } catch (error) {
      console.error('Error getting git status:', error);
      return '';
    }
  }
  
  /**
   * List all branches for a project
   */
  async listBranches(projectPath: string): Promise<string[]> {
    try {
      const { stdout } = await execAsync(`cd ${projectPath} && git branch --format="%(refname:short)"`);
      return stdout.trim().split('\n').filter(branch => branch);
    } catch (error) {
      console.error('Error listing branches:', error);
      return [];
    }
  }
  
  /**
   * Setup git credentials using GITHUB_TOKEN
   */
  private async setupGitCredentials(): Promise<void> {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN environment variable is required');
    }
    
    // Configure git user
    await execAsync(`git config --global user.email "claude@webordinary.com"`);
    await execAsync(`git config --global user.name "Claude Code"`);
    
    // Add safe directory for all workspace directories to avoid ownership issues
    await execAsync(`git config --global --add safe.directory '*'`);
    
    // Set up credentials using the store helper with explicit path
    const credentialsFile = '/tmp/.git-credentials';
    await fs.writeFile(credentialsFile, `https://${process.env.GITHUB_TOKEN}@github.com\n`, { mode: 0o600 });
    
    // Configure git to use the credentials file
    await execAsync(`git config --global credential.helper "store --file=${credentialsFile}"`);
    
    // Also set the GitHub token as a URL-specific credential for better compatibility
    await execAsync(`git config --global url."https://${process.env.GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"`);
  }
  
  /**
   * Check if a branch exists
   */
  private async branchExists(projectPath: string, branch: string): Promise<boolean> {
    try {
      await execAsync(`cd ${projectPath} && git rev-parse --verify ${branch}`);
      return true;
    } catch {
      return false;
    }
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
  
  /**
   * Save user metadata
   */
  private async saveUserMetadata(clientId: string, userId: string, metadata: UserMetadata): Promise<void> {
    const metadataPath = path.join(this.baseDir, clientId, userId, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }
  
  /**
   * Update user's last accessed time
   */
  private async updateUserLastAccessed(clientId: string, userId: string): Promise<void> {
    const metadataPath = path.join(this.baseDir, clientId, userId, 'metadata.json');
    
    if (await this.pathExists(metadataPath)) {
      try {
        const content = await fs.readFile(metadataPath, 'utf-8');
        const metadata = JSON.parse(content);
        metadata.lastAccessed = new Date().toISOString();
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      } catch (error) {
        console.error('Error updating last accessed time:', error);
      }
    }
  }

  // ===== ENHANCED GIT OPERATIONS =====

  /**
   * Fetch latest changes from remote
   */
  async fetchRemote(projectPath: string): Promise<void> {
    console.log('Fetching latest from remote...');
    await execAsync(`cd ${projectPath} && git fetch --all --prune`);
  }

  /**
   * Push changes to remote branch
   */
  async pushToRemote(projectPath: string, branch: string, force = false): Promise<PushResult> {
    // Check if branch is protected
    if (this.gitConfig.protectedBranches.includes(branch) && !force) {
      throw new Error(`Cannot push to protected branch: ${branch}`);
    }

    const forceFlag = force ? '--force-with-lease' : '';
    
    try {
      // Set upstream if not exists
      await execAsync(
        `cd ${projectPath} && git push ${forceFlag} -u ${this.gitConfig.remoteName} ${branch}`
      );
      
      // Get the remote URL for PR creation
      const remoteUrl = await this.getRemoteUrl(projectPath);
      const prUrl = this.generatePRUrl(remoteUrl, branch);
      
      return {
        success: true,
        branch,
        prUrl,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        branch,
      };
    }
  }

  /**
   * Pull changes from remote branch
   */
  async pullFromRemote(projectPath: string, branch: string): Promise<void> {
    // Fetch first to get latest refs
    await execAsync(`cd ${projectPath} && git fetch ${this.gitConfig.remoteName}`);
    
    // Pull with merge strategy
    await execAsync(`cd ${projectPath} && git pull ${this.gitConfig.remoteName} ${branch}`);
  }

  /**
   * Smart commit with automatic push based on configuration
   */
  async smartCommit(
    projectPath: string,
    message: string,
    threadId: string
  ): Promise<CommitResult> {
    const branch = await this.getCurrentBranch(projectPath);
    
    // Add all changes
    await execAsync(`cd ${projectPath} && git add -A`);
    
    // Check if there are changes to commit
    const status = await execAsync(`cd ${projectPath} && git status --porcelain`);
    if (!status.stdout.trim()) {
      return {
        success: false,
        message: 'No changes to commit',
        branch,
        pushed: false,
      };
    }
    
    // Commit with thread ID in message
    const fullMessage = `${message}\n\nThread-ID: ${threadId}`;
    await execAsync(`cd ${projectPath} && git commit -m "${fullMessage}"`);
    
    // Get commit hash
    const commitHashResult = await execAsync(`cd ${projectPath} && git rev-parse HEAD`);
    const commitHash = commitHashResult.stdout.trim();
    
    // Auto-push if enabled and not on protected branch
    let pushResult;
    if (this.gitConfig.autoPush && !this.gitConfig.protectedBranches.includes(branch)) {
      pushResult = await this.pushToRemote(projectPath, branch);
    }
    
    return {
      success: true,
      commitHash,
      branch,
      pushed: pushResult?.success || false,
      prUrl: pushResult?.prUrl,
    };
  }

  /**
   * Get enhanced git status with remote comparison
   */
  async getEnhancedStatus(projectPath: string): Promise<GitStatus> {
    const branch = await this.getCurrentBranch(projectPath);
    
    // Fetch latest (don't pull, just update refs)
    try {
      await this.fetchRemote(projectPath);
    } catch (error) {
      console.log('Warning: Could not fetch from remote');
    }
    
    // Get local status
    const status = await execAsync(`cd ${projectPath} && git status --porcelain`);
    
    // Get ahead/behind counts (handle case where remote branch doesn't exist)
    let ahead = 0;
    let behind = 0;
    
    try {
      const aheadResult = await execAsync(
        `cd ${projectPath} && git rev-list --count ${this.gitConfig.remoteName}/${branch}..HEAD`
      );
      ahead = parseInt(aheadResult.stdout.trim()) || 0;
    } catch {
      // Remote branch might not exist yet
    }
    
    try {
      const behindResult = await execAsync(
        `cd ${projectPath} && git rev-list --count HEAD..${this.gitConfig.remoteName}/${branch}`
      );
      behind = parseInt(behindResult.stdout.trim()) || 0;
    } catch {
      // Remote branch might not exist yet
    }
    
    // Get uncommitted changes
    const changes = this.parseGitStatus(status.stdout);
    
    return {
      branch,
      clean: !status.stdout.trim(),
      ahead,
      behind,
      changes,
      canPush: !this.gitConfig.protectedBranches.includes(branch),
    };
  }

  /**
   * Switch to a branch safely (with stashing)
   */
  async switchBranch(
    projectPath: string,
    targetBranch: string,
    createNew = false
  ): Promise<void> {
    // Check for uncommitted changes
    const status = await execAsync(`cd ${projectPath} && git status --porcelain`);
    
    if (status.stdout.trim()) {
      // Stash changes
      await execAsync(`cd ${projectPath} && git stash push -m "Auto-stash before branch switch"`);
    }
    
    if (createNew) {
      // Create and switch to new branch
      await execAsync(`cd ${projectPath} && git checkout -b ${targetBranch}`);
    } else {
      // Fetch and switch
      try {
        await execAsync(`cd ${projectPath} && git fetch ${this.gitConfig.remoteName} ${targetBranch}`);
      } catch {
        // Remote branch might not exist
      }
      await execAsync(`cd ${projectPath} && git checkout ${targetBranch}`);
    }
    
    // Apply stash if exists
    try {
      await execAsync(`cd ${projectPath} && git stash pop`);
    } catch {
      // No stash to pop
    }
  }

  // ===== HELPER METHODS =====

  private async getCurrentBranch(projectPath: string): Promise<string> {
    const result = await execAsync(`cd ${projectPath} && git branch --show-current`);
    return result.stdout.trim();
  }

  private async getRemoteUrl(projectPath: string): Promise<string> {
    const result = await execAsync(
      `cd ${projectPath} && git remote get-url ${this.gitConfig.remoteName}`
    );
    return result.stdout.trim();
  }

  private generatePRUrl(remoteUrl: string, branch: string): string {
    // Convert git URL to GitHub PR URL
    const match = remoteUrl.match(/github\.com[:/]([\w-]+)\/([\w-]+)/);
    if (match) {
      const [, owner, repo] = match;
      const cleanRepo = repo.replace('.git', '');
      return `https://github.com/${owner}/${cleanRepo}/compare/${this.gitConfig.defaultBranch}...${branch}?expand=1`;
    }
    return '';
  }

  private parseGitStatus(statusOutput: string): GitChanges {
    const lines = statusOutput.trim().split('\n').filter(Boolean);
    const changes = {
      added: [] as string[],
      modified: [] as string[],
      deleted: [] as string[],
      untracked: [] as string[],
    };
    
    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3);
      
      if (status.includes('A')) changes.added.push(file);
      else if (status.includes('M')) changes.modified.push(file);
      else if (status.includes('D')) changes.deleted.push(file);
      else if (status === '??') changes.untracked.push(file);
    }
    
    return changes;
  }
}