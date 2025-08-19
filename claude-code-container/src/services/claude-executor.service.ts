import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { query } from '@anthropic-ai/claude-code';

const execAsync = promisify(exec);

@Injectable()
export class ClaudeExecutorService {
  private readonly logger = new Logger(ClaudeExecutorService.name);
  private readonly workspacePath: string;

  constructor() {
    this.workspacePath = process.env.WORKSPACE_PATH || '/workspace';
  }

  async execute(instruction: string, context?: any): Promise<any> {
    this.logger.log(`Executing Claude Code instruction: ${instruction.substring(0, 100)}...`);
    
    // Check if we're in simulation mode
    const simulationMode = process.env.CLAUDE_SIMULATION_MODE === 'true';
    
    if (simulationMode) {
      this.logger.log('📝 Using simulation mode for Claude API');
      
      // Simulate processing the instruction
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate processing time
      
      // Determine the correct project path from context
      const projectPath = context?.projectPath || this.workspacePath;
      
      // Create a test file to demonstrate the system works
      const testFilePath = path.join(projectPath, 'test-page.html');
      const testContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Page</title>
</head>
<body>
    <h1>Claude Code Simulation</h1>
    <p>Instruction processed: ${instruction}</p>
    <p>Generated at: ${new Date().toISOString()}</p>
</body>
</html>`;
      
      try {
        await fs.writeFile(testFilePath, testContent);
        this.logger.log(`Created test file: ${testFilePath}`);
        
        // Return a result that includes the file change
        return {
          success: true,
          output: `Simulated: ${instruction}`,
          summary: 'Test file created successfully',
          filesChanged: ['test-page.html']
        };
      } catch (error: any) {
        this.logger.warn(`Failed to create test file: ${error.message}`);
      }
      
      return {
        output: `Simulated execution: ${instruction}`,
        filesChanged: ['test-page.html'],
        summary: 'Created a test HTML page as requested (simulation mode)',
        success: true,
      };
    }
    
    try {
      // Determine the correct project path from context
      const projectPath = context?.projectPath || this.workspacePath;
      
      const useBedrock = process.env.CLAUDE_CODE_USE_BEDROCK !== '0';
      this.logger.log(`Using Claude Code SDK with ${useBedrock ? 'Bedrock' : 'Anthropic API'} backend`);
      
      // Configure environment based on backend
      if (useBedrock) {
        // Configure for Bedrock
        process.env.CLAUDE_CODE_USE_BEDROCK = '1';
        process.env.AWS_REGION = process.env.AWS_REGION || 'us-west-2';
      } else {
        // Configure for Anthropic API - credentials from ~/.claude
        process.env.CLAUDE_CODE_USE_BEDROCK = '0';
        // The SDK will automatically look for credentials in ~/.claude
      }
      
      // Common configuration
      process.env.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'sonnet';
      process.env.ANTHROPIC_SMALL_FAST_MODEL = process.env.ANTHROPIC_SMALL_FAST_MODEL || 'haiku';
      process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS || '4096';
      process.env.MAX_THINKING_TOKENS = process.env.MAX_THINKING_TOKENS || '1024';
      
      // Ensure Node is in PATH for the Claude SDK spawn operations
      // Set NODE environment variable to the current Node executable
      process.env.NODE = process.execPath;
      
      // Also ensure PATH includes the Node binary directory
      const nodeDir = require('path').dirname(process.execPath);
      if (!process.env.PATH?.includes(nodeDir)) {
        process.env.PATH = `${nodeDir}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`;
      }
      
      this.logger.log(`Node executable: ${process.execPath}`);
      this.logger.log(`PATH configured with Node directory: ${nodeDir}`);
<<<<<<< Updated upstream
<<<<<<< Updated upstream
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
      let output = '';
      let assistantMessages = [];
      let sessionId = '';
      let totalCost = 0;
      let duration = 0;
      
      // Use the Claude Code SDK query function
      this.logger.log(`Executing query with prompt: ${instruction.substring(0, 100)}...`);
      
      // Log authentication details (without exposing secrets)
      if (!useBedrock) {
        this.logger.log(`Looking for Anthropic credentials in ~/.claude (mounted as /home/appuser/.claude)`);
      }
      
      for await (const message of query({
        prompt: instruction,
        options: {
          cwd: projectPath,
          model: 'sonnet',
          maxTurns: 3,
          // Allow file operations but in a controlled manner
          allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'LS', 'Glob']
        }
      })) {
        this.logger.debug(`Received message type: ${message.type}`);
        
        if (message.type === 'system') {
          sessionId = message.session_id;
          this.logger.log(`Claude Code session started: ${sessionId}`);
        } else if (message.type === 'assistant') {
          // Assistant messages contain the actual responses and tool uses
          assistantMessages.push(message.message);
          // Extract text content from the assistant message
          if (message.message && message.message.content) {
            for (const content of message.message.content) {
              if (content.type === 'text') {
                output += content.text + '\n';
              }
            }
          }
        } else if (message.type === 'result') {
          // Result message indicates completion
          if (message.subtype === 'success' && (message as any).result) {
            output = (message as any).result || output;
          }
          totalCost = message.total_cost_usd || 0;
          duration = message.duration_ms || 0;
          this.logger.log(`Task completed - Cost: $${totalCost}, Duration: ${duration}ms`);
          break;
        }
      }
      
      // Detect file changes via git
      const filesChanged = await this.detectFileChanges(projectPath, {});
      
      return {
        success: true,
        output: output.trim(),
        summary: 'Task completed successfully',
        filesChanged,
        cost: totalCost,
        duration,
        sessionId
      };
    } catch (error: any) {
      this.logger.error(`Claude Code SDK execution failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Detect which files were changed by comparing git status before/after
   * or by parsing Claude's output for file operations
   */
  private async detectFileChanges(projectPath: string, result: any): Promise<string[]> {
    try {
      // Try to get modified files from git
      const { stdout } = await execAsync('git diff --name-only HEAD', {
        cwd: projectPath
      });
      
      const modifiedFiles = stdout.trim().split('\n').filter(f => f);
      
      // Also check for untracked files
      const { stdout: untrackedOutput } = await execAsync('git ls-files --others --exclude-standard', {
        cwd: projectPath
      });
      
      const untrackedFiles = untrackedOutput.trim().split('\n').filter(f => f);
      
      return [...modifiedFiles, ...untrackedFiles];
    } catch (error) {
      this.logger.warn(`Could not detect file changes via git: ${error}`);
      
      // Fallback: try to extract from Claude's output
      if (result.tool_calls) {
        const fileOperations = result.tool_calls.filter((call: any) => 
          ['Edit', 'Write', 'MultiEdit'].includes(call.tool)
        );
        
        return fileOperations.map((op: any) => 
          op.parameters?.file_path || op.parameters?.path
        ).filter(Boolean);
      }
      
      return [];
    }
  }

  async getStatus(): Promise<any> {
    try {
      const { stdout } = await execAsync('claude-code --status', {
        cwd: this.workspacePath,
      });
      return JSON.parse(stdout);
    } catch (error: any) {
      this.logger.error(`Failed to get Claude Code status: ${error.message}`);
      return { status: 'error', message: error.message };
    }
  }

  async saveContext(sessionId: string, context: any): Promise<void> {
    const contextPath = path.join(this.workspacePath, '.claude-context', `${sessionId}.json`);
    await fs.mkdir(path.dirname(contextPath), { recursive: true });
    await fs.writeFile(contextPath, JSON.stringify(context, null, 2));
  }

  async loadContext(sessionId: string): Promise<any> {
    const contextPath = path.join(this.workspacePath, '.claude-context', `${sessionId}.json`);
    try {
      const data = await fs.readFile(contextPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
}