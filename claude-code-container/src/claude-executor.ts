import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { ThreadManager } from './thread-manager';

const execAsync = promisify(exec);

interface ExecutionContext {
  workingDirectory: string;
  gitBranch: string;
  threadId: string;
  history?: any[];
  plans?: any[];
}

interface ExecutionOptions {
  instruction: string;
  mode: 'execute' | 'plan' | 'analyze';
  context: ExecutionContext;
}

interface ExecutionResult {
  success: boolean;
  output: string;
  filesChanged: string[];
  context: ExecutionContext;
  error?: string;
}

export class ClaudeExecutor {
  private workspacePath: string;
  private lastActivity: number = Date.now();
  private threadManager: ThreadManager;
  
  constructor(workspace: { projectPath: string; claudePath: string }) {
    this.workspacePath = workspace.projectPath;
    this.threadManager = new ThreadManager();
    this.updateActivity();
  }
  
  /**
   * Execute Claude Code instruction using Claude CLI
   * For now, this simulates the execution since we'll integrate with Bedrock later
   */
  async execute(options: ExecutionOptions): Promise<ExecutionResult> {
    this.updateActivity();
    
    const { instruction, mode, context } = options;
    
    console.log(`Executing Claude instruction: ${instruction}`);
    console.log(`Mode: ${mode}, Working Directory: ${context.workingDirectory}`);
    
    try {
      // For now, simulate Claude Code SDK execution
      // In Task 03, this will be replaced with actual Bedrock integration
      const result = await this.simulateClaudeExecution(instruction, context);
      
      // Auto-commit if files were changed
      let commitResult;
      if (result.success && result.filesChanged.length > 0) {
        try {
          const commitMessage = `Claude: ${instruction}`.substring(0, 50) + (instruction.length > 50 ? '...' : '');
          commitResult = await this.threadManager.smartCommit(
            context.workingDirectory,
            commitMessage,
            context.threadId
          );
          console.log('Auto-commit result:', commitResult);
        } catch (error) {
          console.warn('Auto-commit failed:', error);
        }
      }
      
      // Update context with execution results
      const updatedContext = {
        ...context,
        history: [...(context.history || []), {
          instruction,
          mode,
          timestamp: new Date().toISOString(),
          result: result.output,
          filesChanged: result.filesChanged,
          committed: commitResult?.success || false,
          commitHash: commitResult?.commitHash,
          pushed: commitResult?.pushed || false,
          prUrl: commitResult?.prUrl
        }]
      };
      
      // Add git info to output if commit was successful
      let enhancedOutput = result.output;
      if (commitResult?.success) {
        enhancedOutput += `\n\n🔄 Changes committed: ${commitResult.commitHash?.substring(0, 7)}`;
        if (commitResult.pushed) {
          enhancedOutput += '\n✅ Pushed to remote';
          if (commitResult.prUrl) {
            enhancedOutput += `\n🔗 Create PR: ${commitResult.prUrl}`;
          }
        }
      }
      
      return {
        success: result.success,
        output: enhancedOutput,
        filesChanged: result.filesChanged,
        context: updatedContext,
        error: result.error
      };
      
    } catch (error) {
      console.error('Claude execution error:', error);
      
      return {
        success: false,
        output: '',
        filesChanged: [],
        context,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Get workspace status
   */
  async getStatus(): Promise<{
    workingDirectory: string;
    gitStatus: string;
    lastActivity: number;
  }> {
    this.updateActivity();
    
    try {
      const { stdout: gitStatus } = await execAsync(`cd ${this.workspacePath} && git status --short`);
      
      return {
        workingDirectory: this.workspacePath,
        gitStatus: gitStatus.trim(),
        lastActivity: this.lastActivity
      };
    } catch (error) {
      console.error('Error getting status:', error);
      return {
        workingDirectory: this.workspacePath,
        gitStatus: 'Error getting git status',
        lastActivity: this.lastActivity
      };
    }
  }
  
  /**
   * Update last activity timestamp for auto-shutdown
   */
  private updateActivity(): void {
    this.lastActivity = Date.now();
    
    // Update activity file for auto-shutdown script
    const activityFile = '/tmp/last_activity';
    fs.writeFile(activityFile, Math.floor(this.lastActivity / 1000).toString())
      .catch(error => console.error('Error updating activity file:', error));
  }
  
  /**
   * Simulate Claude Code SDK execution
   * This is a placeholder that will be replaced with actual Bedrock integration in Task 03
   */
  private async simulateClaudeExecution(
    instruction: string, 
    context: ExecutionContext
  ): Promise<{ success: boolean; output: string; filesChanged: string[]; error?: string }> {
    
    // Simple pattern matching for basic operations
    const lowerInstruction = instruction.toLowerCase();
    
    try {
      if (lowerInstruction.includes('create') && lowerInstruction.includes('file')) {
        return await this.simulateFileCreation(instruction, context);
      }
      
      if (lowerInstruction.includes('update') || lowerInstruction.includes('modify') || lowerInstruction.includes('edit')) {
        return await this.simulateFileEdit(instruction, context);
      }
      
      if (lowerInstruction.includes('list') || lowerInstruction.includes('show')) {
        return await this.simulateFileList(context);
      }
      
      if (lowerInstruction.includes('git') && lowerInstruction.includes('status')) {
        return await this.simulateGitStatus(context);
      }
      
      // Default response for unsupported instructions
      return {
        success: true,
        output: `Simulated execution of: "${instruction}"\\n\\nThis is a placeholder response. In Task 03, this will be replaced with actual Claude Code SDK integration via AWS Bedrock.\\n\\nCurrent working directory: ${context.workingDirectory}\\nGit branch: ${context.gitBranch}\\nThread ID: ${context.threadId}`,
        filesChanged: []
      };
      
    } catch (error) {
      return {
        success: false,
        output: '',
        filesChanged: [],
        error: error instanceof Error ? error.message : 'Simulation error'
      };
    }
  }
  
  private async simulateFileCreation(instruction: string, context: ExecutionContext) {
    // Extract filename from instruction (very basic)
    const matches = instruction.match(/create.*?file.*?"?([\\w\\-\\.]+)"?/i);
    const filename = matches ? matches[1] : 'example.md';
    
    const filePath = path.join(context.workingDirectory, filename);
    const content = `# ${filename}\\n\\nThis file was created by Claude Code simulation.\\nInstruction: ${instruction}\\nTimestamp: ${new Date().toISOString()}`;
    
    await fs.writeFile(filePath, content);
    
    return {
      success: true,
      output: `Created file: ${filename}`,
      filesChanged: [filename]
    };
  }
  
  private async simulateFileEdit(instruction: string, context: ExecutionContext) {
    // Look for existing files to edit
    const files = await fs.readdir(context.workingDirectory);
    const mdFiles = files.filter(f => f.endsWith('.md') || f.endsWith('.astro'));
    
    if (mdFiles.length > 0) {
      const targetFile = mdFiles[0];
      const filePath = path.join(context.workingDirectory, targetFile);
      
      // Append to the file
      const appendContent = `\\n\\n## Updated by Claude\\nInstruction: ${instruction}\\nTimestamp: ${new Date().toISOString()}`;
      
      await fs.appendFile(filePath, appendContent);
      
      return {
        success: true,
        output: `Updated file: ${targetFile}`,
        filesChanged: [targetFile]
      };
    }
    
    return {
      success: true,
      output: 'No suitable files found to edit',
      filesChanged: []
    };
  }
  
  private async simulateFileList(context: ExecutionContext) {
    const files = await fs.readdir(context.workingDirectory);
    
    return {
      success: true,
      output: `Files in ${context.workingDirectory}:\\n${files.map(f => `- ${f}`).join('\\n')}`,
      filesChanged: []
    };
  }
  
  private async simulateGitStatus(context: ExecutionContext) {
    try {
      const { stdout } = await execAsync(`cd ${context.workingDirectory} && git status --short`);
      
      return {
        success: true,
        output: `Git status:\\n${stdout || 'Working tree clean'}`,
        filesChanged: []
      };
    } catch (error) {
      return {
        success: false,
        output: 'Error getting git status',
        filesChanged: [],
        error: error instanceof Error ? error.message : 'Unknown git error'
      };
    }
  }
}