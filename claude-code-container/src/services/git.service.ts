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
  }

  async checkoutBranch(branch: string): Promise<void> {
    try {
      await execAsync(`git checkout ${branch}`, { cwd: this.workspacePath });
      this.logger.log(`Checked out branch: ${branch}`);
    } catch (error: any) {
      this.logger.error(`Failed to checkout branch ${branch}: ${error.message}`);
      throw error;
    }
  }

  async createBranch(branch: string): Promise<void> {
    try {
      await execAsync(`git checkout -b ${branch}`, { cwd: this.workspacePath });
      this.logger.log(`Created and checked out new branch: ${branch}`);
    } catch (error: any) {
      this.logger.error(`Failed to create branch ${branch}: ${error.message}`);
      throw error;
    }
  }

  async autoCommitChanges(message: string): Promise<void> {
    try {
      // Check if there are changes to commit
      const { stdout: status } = await execAsync('git status --porcelain', { 
        cwd: this.workspacePath 
      });
      
      if (!status.trim()) {
        this.logger.debug('No changes to commit');
        return;
      }

      // Stage all changes
      await execAsync('git add -A', { cwd: this.workspacePath });
      
      // Commit with message
      await execAsync(`git commit -m "Auto-save: ${message}"`, { 
        cwd: this.workspacePath 
      });
      
      this.logger.log(`Auto-committed changes: ${message}`);
    } catch (error: any) {
      this.logger.warn(`Auto-commit failed: ${error.message}`);
      // Non-fatal error, continue processing
    }
  }

  async getCurrentBranch(): Promise<string> {
    try {
      const { stdout } = await execAsync('git branch --show-current', {
        cwd: this.workspacePath,
      });
      return stdout.trim();
    } catch (error: any) {
      this.logger.error(`Failed to get current branch: ${error.message}`);
      return 'main';
    }
  }

  async getStatus(): Promise<string> {
    try {
      const { stdout } = await execAsync('git status', {
        cwd: this.workspacePath,
      });
      return stdout;
    } catch (error: any) {
      this.logger.error(`Failed to get git status: ${error.message}`);
      return '';
    }
  }

  async push(branchOrWorkspacePath?: string, branchIfWorkspace?: string, force: boolean = false): Promise<void> {
    try {
      let cwd = this.workspacePath;
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

  async pull(branch: string = 'main'): Promise<void> {
    try {
      await execAsync(`git pull origin ${branch}`, {
        cwd: this.workspacePath,
      });
      this.logger.log(`Pulled from origin/${branch}`);
    } catch (error: any) {
      this.logger.error(`Failed to pull: ${error.message}`);
      throw error;
    }
  }

  async fetch(): Promise<void> {
    try {
      await execAsync('git fetch --all', {
        cwd: this.workspacePath,
      });
      this.logger.log('Fetched all remotes');
    } catch (error: any) {
      this.logger.error(`Failed to fetch: ${error.message}`);
      throw error;
    }
  }

  async initRepository(repoUrl?: string): Promise<void> {
    try {
      const clientId = process.env.CLIENT_ID || process.env.DEFAULT_CLIENT_ID || 'ameliastamps';
      const userId = process.env.USER_ID || process.env.DEFAULT_USER_ID || 'scott';
      const projectPath = `${this.workspacePath}/${clientId}/${userId}/amelia-astro`;
      
      // Ensure project directory exists
      await execAsync(`mkdir -p ${projectPath}`);
      
      // Check if already a git repo
      try {
        await execAsync('git rev-parse --git-dir', { cwd: projectPath });
        this.logger.log('Git repository already initialized in ' + projectPath);
        
        // Pull latest changes if repo exists
        if (repoUrl) {
          try {
            await execAsync('git pull origin main', { cwd: projectPath });
            this.logger.log('Pulled latest changes from repository');
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
        
        // Clone the repository with GitHub token authentication
        const githubToken = process.env.GITHUB_TOKEN;
        let authenticatedUrl = repoUrl;
        
        if (githubToken && repoUrl.includes('github.com')) {
          // Add token to URL for authentication
          authenticatedUrl = repoUrl.replace('https://github.com/', `https://${githubToken}@github.com/`);
        }
        
        await execAsync(`git clone ${authenticatedUrl} ${projectPath}`);
        this.logger.log(`Cloned repository from ${repoUrl} to ${projectPath}`);
      } else {
        // Initialize empty repo
        await execAsync('git init', { cwd: projectPath });
        this.logger.log('Initialized empty git repository in ' + projectPath);
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
      const cwd = workspacePath || this.workspacePath;
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
      const cwd = workspacePath || this.workspacePath;
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
      const cwd = workspacePath || this.workspacePath;
      await execAsync(`git commit -m "${message}"`, { cwd });
      this.logger.log(`Committed changes: ${message}`);
    } catch (error: any) {
      this.logger.error(`Failed to commit: ${error.message}`);
      throw error;
    }
  }

}