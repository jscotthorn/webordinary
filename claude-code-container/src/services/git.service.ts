import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);
  private readonly workspacePath: string;

  constructor() {
    this.workspacePath = process.env.WORKSPACE_PATH || '/workspace';
    // Configure git credentials on initialization
    this.configureGitCredentials().catch(err => 
      this.logger.warn(`Failed to configure git credentials: ${err.message}`)
    );
  }

  /**
   * Configure git credentials and user info for the container
   */
  async configureGitCredentials(): Promise<void> {
    try {
      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        this.logger.error('GITHUB_TOKEN is required for git operations');
        throw new Error('GITHUB_TOKEN is required for git operations');
      }
      
      // Set git user info
      await execAsync(`git config --global user.email "container@webordinary.com"`);
      await execAsync(`git config --global user.name "WebOrdinary Container"`);
      
      // Configure git to use token for HTTPS authentication
      await execAsync(`git config --global credential.helper store`);
      
      // Create credentials file with token
      const credentialsPath = `${process.env.HOME || '/home/appuser'}/.git-credentials`;
      const credentialEntry = `https://${token}:x-oauth-basic@github.com\n`;
      
      // Write credentials to file
      const fs = require('fs').promises;
      await fs.writeFile(credentialsPath, credentialEntry, { mode: 0o600 });
      
      this.logger.debug('Git credentials configured successfully with GitHub token');
    } catch (error: any) {
      this.logger.error(`Failed to configure git credentials: ${error.message}`);
      throw error;
    }
  }

  async checkoutBranch(branch: string): Promise<void> {
    const projectPath = this.getRepoPath();
    try {
      await execAsync(`git checkout ${branch}`, { cwd: projectPath });
      this.logger.log(`Checked out branch: ${branch}`);
    } catch (error: any) {
      this.logger.error(`Failed to checkout branch ${branch}: ${error.message}`);
      throw error;
    }
  }

  async createBranch(branch: string): Promise<void> {
    const projectPath = this.getRepoPath();
    try {
      // Always create new branches from main to ensure clean state
      await execAsync(`git checkout -b ${branch} origin/main`, { cwd: projectPath });
      this.logger.log(`Created and checked out new branch: ${branch} from main`);
    } catch (error: any) {
      this.logger.error(`Failed to create branch ${branch}: ${error.message}`);
      throw error;
    }
  }

  async autoCommitChanges(message: string, pushAfter: boolean = true): Promise<void> {
    const projectPath = this.getRepoPath();
    try {
      // Check if there are changes to commit
      const { stdout: status } = await execAsync('git status --porcelain', { 
        cwd: projectPath 
      });
      
      if (!status.trim()) {
        this.logger.debug('No changes to commit');
        return;
      }

      // Stage all changes
      await execAsync('git add -A', { cwd: projectPath });
      
      // Commit with message
      await execAsync(`git commit -m "Auto-save: ${message}"`, { 
        cwd: projectPath 
      });
      
      this.logger.log(`Auto-committed changes: ${message}`);
      
      // NEW: Push to remote if requested and enabled
      if (pushAfter && process.env.GIT_PUSH_ENABLED !== 'false') {
        try {
          await this.push();
          this.logger.log('Pushed auto-commit to remote');
        } catch (pushError: any) {
          this.logger.warn(`Failed to push auto-commit: ${pushError.message}`);
          // Don't throw - push failure shouldn't break workflow
        }
      }
    } catch (error: any) {
      this.logger.warn(`Auto-commit failed: ${error.message}`);
      // Non-fatal error, continue processing
    }
  }

  /**
   * Commit with both subject and body for detailed messages
   */
  async commitWithBody(subject: string, body?: string): Promise<void> {
    const projectPath = this.getRepoPath();
    try {
      // Check if there are changes to commit
      const { stdout: status } = await execAsync('git status --porcelain', { 
        cwd: projectPath 
      });
      
      if (!status.trim()) {
        this.logger.debug('No changes to commit');
        return;
      }

      // Stage all changes
      await execAsync('git add -A', { cwd: projectPath });
      
      if (body) {
        // Use a heredoc-style approach for multi-line commits
        const fullMessage = `${subject}\n\n${body}`;
        // Write message to a temp file to avoid escaping issues
        const tempFile = `/tmp/commit-msg-${Date.now()}.txt`;
        const fs = require('fs').promises;
        await fs.writeFile(tempFile, fullMessage);
        
        try {
          await execAsync(`git commit -F ${tempFile}`, { cwd: projectPath });
          await fs.unlink(tempFile); // Clean up temp file
        } catch (commitError) {
          await fs.unlink(tempFile); // Clean up even on error
          throw commitError;
        }
      } else {
        // Simple single-line commit
        await execAsync(`git commit -m "${subject.replace(/"/g, '\\"')}"`, { 
          cwd: projectPath 
        });
      }
      
      this.logger.log(`Committed: ${subject}`);
    } catch (error: any) {
      this.logger.error(`Failed to commit: ${error.message}`);
      throw error;
    }
  }

  async getCurrentBranch(): Promise<string> {
    const projectPath = this.getRepoPath();
    try {
      const { stdout } = await execAsync('git branch --show-current', {
        cwd: projectPath,
      });
      return stdout.trim();
    } catch (error: any) {
      this.logger.error(`Failed to get current branch: ${error.message}`);
      return 'main';
    }
  }

  async getStatus(): Promise<string> {
    const projectPath = this.getRepoPath();
    try {
      const { stdout } = await execAsync('git status', {
        cwd: projectPath,
      });
      return stdout;
    } catch (error: any) {
      this.logger.error(`Failed to get git status: ${error.message}`);
      return '';
    }
  }

  async push(branchOrWorkspacePath?: string, branchIfWorkspace?: string, force: boolean = false): Promise<void> {
    try {
      let cwd = this.getProjectPath();
      let currentBranch: string;
      
      // Handle overloaded parameters
      if (branchOrWorkspacePath && branchOrWorkspacePath.includes('/')) {
        // First parameter is workspace path
        cwd = branchOrWorkspacePath;
        currentBranch = branchIfWorkspace || await this.getCurrentBranch();
      } else {
        // First parameter is branch name (or undefined)
        currentBranch = branchOrWorkspacePath || await this.getCurrentBranch();
        // Handle the case where second param is force boolean (legacy signature)
        if (typeof branchIfWorkspace === 'boolean') {
          force = branchIfWorkspace;
        }
      }
      
      const forceFlag = force ? '--force' : '';
      await execAsync(`git push origin ${currentBranch} ${forceFlag}`, { cwd });
      this.logger.log(`Pushed branch ${currentBranch} to remote`);
    } catch (error: any) {
      this.logger.error(`Failed to push: ${error.message}`);
      throw error;
    }
  }

  /**
   * Push with retry logic for handling transient failures
   */
  async pushWithRetry(maxRetries: number = 3): Promise<boolean> {
    const retryCount = parseInt(process.env.GIT_PUSH_RETRY_COUNT || '3', 10);
    const attempts = Math.min(maxRetries, retryCount);
    
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.push();
        return true;
      } catch (error: any) {
        this.logger.warn(`Push attempt ${attempt}/${attempts} failed: ${error.message}`);
        
        if (attempt === attempts) {
          this.logger.error('All push attempts failed');
          return false;
        }
        
        // Wait before retry (exponential backoff)
        const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        this.logger.debug(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    return false;
  }

  async pull(branch: string = 'main'): Promise<void> {
    const projectPath = this.getRepoPath();
    try {
      await execAsync(`git pull origin ${branch}`, {
        cwd: projectPath,
      });
      this.logger.log(`Pulled from origin/${branch}`);
    } catch (error: any) {
      this.logger.error(`Failed to pull: ${error.message}`);
      throw error;
    }
  }

  async fetch(): Promise<void> {
    const projectPath = this.getRepoPath();
    try {
      await execAsync('git fetch --all', {
        cwd: projectPath,
      });
      this.logger.log('Fetched all remotes');
    } catch (error: any) {
      this.logger.error(`Failed to fetch: ${error.message}`);
      throw error;
    }
  }

  private getProjectPath(): string {
    // Use environment variables or default path
    const projectId = process.env.PROJECT_ID || 'default';
    const userId = process.env.USER_ID || 'user';
    return `${this.workspacePath}/${projectId}/${userId}`;
  }

  /**
   * Get the full path including the repository name
   * This should be used for all git operations after init
   */
  private getRepoPath(): string {
    const basePath = this.getProjectPath();
    // For now, assume amelia-astro is the repo name
    // TODO: Store repo name in claim or retrieve from git config
    return `${basePath}/amelia-astro`;
  }

  async initRepository(repoUrl?: string): Promise<void> {
    try {
      // Use environment variables or passed parameters
      const clientId = process.env.PROJECT_ID || 'default';
      const userId = process.env.USER_ID || 'user';
      
      // Extract repo name from URL if provided
      let repoName = 'workspace'; // default
      if (repoUrl) {
        const match = repoUrl.match(/\/([^\/]+?)(?:\.git)?$/);
        if (match) {
          repoName = match[1];
        }
      }
      
      const basePath = this.getProjectPath();
      const projectPath = `${basePath}/${repoName}`;
      
      // Ensure project directory exists
      await execAsync(`mkdir -p ${projectPath}`);
      
      // Check if already a git repo
      try {
        await execAsync('git rev-parse --git-dir', { cwd: projectPath });
        this.logger.log('Git repository already initialized in ' + projectPath);
        
        // Pull latest changes if repo exists
        if (repoUrl) {
          try {
            // First check which branch exists on remote
            const { stdout: remoteBranches } = await execAsync('git ls-remote --heads origin', { cwd: projectPath });
            const hasMain = remoteBranches.includes('refs/heads/main');
            const hasMaster = remoteBranches.includes('refs/heads/master');
            
            const defaultBranch = hasMain ? 'main' : (hasMaster ? 'master' : null);
            if (defaultBranch) {
              await execAsync(`git pull origin ${defaultBranch}`, { cwd: projectPath });
              this.logger.log(`Pulled latest changes from ${defaultBranch} branch`);
            } else {
              this.logger.warn('No main or master branch found on remote');
            }
          } catch (pullError: any) {
            this.logger.warn(`Could not pull latest changes: ${pullError.message}`);
          }
        }
        return;
      } catch {
        // Not a git repo, need to initialize/clone it
      }

      if (repoUrl) {
        // Check if directory is empty
        const { stdout: files } = await execAsync('ls -A', { cwd: projectPath });
        
        if (files.trim()) {
          // Directory not empty, clean it first
          this.logger.warn('Directory not empty, cleaning before clone');
          await execAsync(`rm -rf ${projectPath}/*`, { cwd: projectPath });
          await execAsync(`rm -rf ${projectPath}/.*`, { cwd: projectPath }).catch(() => {});
        }
        
        // Try to clone the repository
        // Git credentials are already configured via credential store
        try {
          await execAsync(`git clone ${repoUrl} ${projectPath}`);
          this.logger.log(`Cloned repository from ${repoUrl} to ${projectPath}`);
          
          // Install npm dependencies if package.json exists
          const fs = require('fs').promises;
          const packageJsonPath = `${projectPath}/package.json`;
          try {
            await fs.access(packageJsonPath);
            this.logger.log('Installing npm dependencies...');
            await execAsync('npm install', { cwd: projectPath });
            this.logger.log('Dependencies installed successfully');
          } catch {
            this.logger.debug('No package.json found, skipping npm install');
          }
        } catch (cloneError: any) {
          // If clone fails (e.g., repo doesn't exist), create a local repository
          this.logger.warn(`Clone failed (${cloneError.message}), creating local repository`);
          
          // Initialize empty repo
          await execAsync('git init', { cwd: projectPath });
          
          // Set remote origin for future push
          await execAsync(`git remote add origin ${repoUrl}`, { cwd: projectPath });
          
          // Create initial README
          const readmeContent = `# ${clientId} Project\n\nInitialized on ${new Date().toISOString()}\n`;
          await execAsync(`echo "${readmeContent}" > README.md`, { cwd: projectPath });
          
          // Initial commit
          await execAsync('git add .', { cwd: projectPath });
          await execAsync('git commit -m "Initial commit"', { cwd: projectPath });
          
          this.logger.log(`Created local repository with remote origin: ${repoUrl}`);
        }
      } else {
        // Initialize empty repo without remote
        await execAsync('git init', { cwd: projectPath });
        
        // Create initial README
        const readmeContent = `# Local Project\n\nInitialized on ${new Date().toISOString()}\n`;
        await execAsync(`echo "${readmeContent}" > README.md`, { cwd: projectPath });
        
        // Initial commit
        await execAsync('git add .', { cwd: projectPath });
        await execAsync('git commit -m "Initial commit"', { cwd: projectPath });
        
        this.logger.log('Initialized local git repository in ' + projectPath);
      }
    } catch (error: any) {
      this.logger.error(`Failed to initialize repository: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if there are uncommitted changes
   */
  async hasUncommittedChanges(workspacePath?: string): Promise<boolean> {
    try {
      const cwd = workspacePath || this.getRepoPath();
      const { stdout } = await execAsync('git status --porcelain', { cwd });
      return stdout.trim().length > 0;
    } catch (error: any) {
      this.logger.error(`Failed to check uncommitted changes: ${error.message}`);
      return false;
    }
  }

  /**
   * Stage changes for commit
   */
  async stageChanges(workspacePath?: string, files: string = '.'): Promise<void> {
    try {
      const cwd = workspacePath || this.getRepoPath();
      await execAsync(`git add ${files}`, { cwd });
      this.logger.debug(`Staged changes: ${files}`);
    } catch (error: any) {
      this.logger.error(`Failed to stage changes: ${error.message}`);
      throw error;
    }
  }

  /**
   * Commit staged changes
   */
  async commit(message: string, workspacePath?: string): Promise<void> {
    try {
      const cwd = workspacePath || this.getRepoPath();
      await execAsync(`git commit -m "${message}"`, { cwd });
      this.logger.log(`Committed changes: ${message}`);
    } catch (error: any) {
      this.logger.error(`Failed to commit: ${error.message}`);
      throw error;
    }
  }

  /**
   * Safely switch branches with stash support
   */
  async safeBranchSwitch(targetBranch: string): Promise<boolean> {
    const projectPath = this.getRepoPath();
    try {
      // Check for uncommitted changes
      const hasChanges = await this.hasUncommittedChanges();
      
      if (hasChanges) {
        this.logger.log('Uncommitted changes detected, stashing...');
        
        // Stash changes with descriptive message
        const stashMessage = `Auto-stash before switching to ${targetBranch}`;
        await execAsync(`git stash push -m "${stashMessage}"`, {
          cwd: projectPath
        });
      }
      
      // Try to checkout branch
      try {
        await execAsync(`git checkout ${targetBranch}`, {
          cwd: projectPath
        });
      } catch (checkoutError: any) {
        // Branch doesn't exist, create it from main
        if (checkoutError.message.includes('did not match any')) {
          await execAsync(`git checkout -b ${targetBranch} origin/main`, {
            cwd: projectPath
          });
        } else {
          throw checkoutError;
        }
      }
      
      // Apply stash if we had changes
      if (hasChanges) {
        try {
          this.logger.log('Applying stashed changes...');
          await execAsync('git stash pop', {
            cwd: projectPath
          });
        } catch (stashError: any) {
          this.logger.warn('Could not apply stash cleanly, keeping in stash list');
          // Changes remain in stash for manual resolution
        }
      }
      
      return true;
    } catch (error: any) {
      this.logger.error(`Failed to switch branch: ${error.message}`);
      return false;
    }
  }

  /**
   * Automatically resolve merge conflicts
   */
  async resolveConflictsAutomatically(): Promise<boolean> {
    const projectPath = this.getRepoPath();
    try {
      // Check if we're in a conflict state
      const { stdout: status } = await execAsync('git status --porcelain', {
        cwd: projectPath
      });
      
      const conflictFiles = status
        .split('\n')
        .filter(line => line.startsWith('UU '))
        .map(line => line.substring(3));
      
      if (conflictFiles.length === 0) {
        return true; // No conflicts
      }
      
      this.logger.warn(`Found ${conflictFiles.length} conflicted files`);
      
      // Strategy: Accept current branch version (--ours)
      for (const file of conflictFiles) {
        await execAsync(`git checkout --ours "${file}"`, {
          cwd: projectPath
        });
        await execAsync(`git add "${file}"`, {
          cwd: projectPath
        });
      }
      
      // Commit the resolution
      await execAsync('git commit -m "Auto-resolved conflicts (kept local changes)"', {
        cwd: projectPath
      });
      
      this.logger.log('Conflicts auto-resolved using local version');
      return true;
    } catch (error: any) {
      this.logger.error(`Failed to resolve conflicts: ${error.message}`);
      return false;
    }
  }

  /**
   * Push with automatic conflict resolution
   */
  async safePush(branch?: string): Promise<boolean> {
    const projectPath = this.getRepoPath();
    try {
      const currentBranch = branch || await this.getCurrentBranch();
      
      // First attempt direct push
      try {
        await execAsync(`git push origin ${currentBranch}`, {
          cwd: projectPath
        });
        this.logger.log(`Pushed branch ${currentBranch} successfully`);
        return true;
      } catch (pushError: any) {
        if (pushError.message.includes('non-fast-forward')) {
          // Remote has changes we don't have
          return await this.handleNonFastForward(currentBranch);
        }
        throw pushError;
      }
    } catch (error: any) {
      this.logger.error(`Safe push failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle non-fast-forward push errors
   */
  private async handleNonFastForward(branch: string): Promise<boolean> {
    const projectPath = this.getRepoPath();
    this.logger.log('Remote has changes, attempting to merge...');
    
    try {
      // Pull with rebase to keep history clean
      await execAsync(`git pull --rebase origin ${branch}`, {
        cwd: projectPath
      });
      
      // Try push again
      await execAsync(`git push origin ${branch}`, {
        cwd: projectPath
      });
      
      this.logger.log('Successfully pushed after rebase');
      return true;
    } catch (rebaseError: any) {
      if (rebaseError.message.includes('conflict')) {
        // Abort rebase and try merge instead
        await execAsync('git rebase --abort', {
          cwd: projectPath
        }).catch(() => {}); // Ignore abort errors
        
        // Try merge strategy
        try {
          await execAsync(`git pull origin ${branch}`, {
            cwd: projectPath
          });
          
          // Resolve any conflicts
          await this.resolveConflictsAutomatically();
          
          // Push merged result
          await execAsync(`git push origin ${branch}`, {
            cwd: projectPath
          });
          
          this.logger.log('Successfully pushed after merge');
          return true;
        } catch (mergeError: any) {
          this.logger.error('Could not automatically resolve push conflict');
          return false;
        }
      }
      
      return false;
    }
  }

  /**
   * Recover repository from bad state
   */
  async recoverRepository(): Promise<void> {
    const projectPath = this.getRepoPath();
    this.logger.log('Attempting repository recovery...');
    
    try {
      // Check if we're in the middle of a merge/rebase
      const { stdout: gitDir } = await execAsync('git rev-parse --git-dir', {
        cwd: projectPath
      });
      
      // Abort any in-progress operations
      await execAsync('git merge --abort', { cwd: projectPath }).catch(() => {});
      await execAsync('git rebase --abort', { cwd: projectPath }).catch(() => {});
      await execAsync('git cherry-pick --abort', { cwd: projectPath }).catch(() => {});
      
      // Reset to clean state if needed
      const { stdout: status } = await execAsync('git status --porcelain', {
        cwd: projectPath
      });
      
      if (status.includes('UU ')) {
        // Unresolved conflicts, reset to HEAD
        await execAsync('git reset --hard HEAD', {
          cwd: projectPath
        });
        this.logger.warn('Reset repository to HEAD due to conflicts');
      }
      
      this.logger.log('Repository recovered');
    } catch (error: any) {
      this.logger.error(`Recovery failed: ${error.message}`);
      throw error;
    }
  }

}