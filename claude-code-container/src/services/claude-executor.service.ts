import { Injectable, Logger } from '@nestjs/common';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';

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
    const simulationMode = process.env.CLAUDE_SIMULATION_MODE === 'true' || process.env.NODE_ENV === 'development';
    
    if (simulationMode) {
      this.logger.log('📝 Using simulation mode for Claude API');
      
      // Simulate processing the instruction
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate processing time
      
      // Create a test file to demonstrate the system works
      const testFilePath = path.join(this.workspacePath, 'test-page.html');
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
      // In production, execute using Claude Code CLI
      const { stdout, stderr } = await execAsync(
        `claude-code --instruction "${instruction}" --workspace "${this.workspacePath}"`,
        {
          cwd: this.workspacePath,
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          timeout: 300000, // 5 minute timeout
        }
      );

      if (stderr) {
        this.logger.warn(`Claude Code stderr: ${stderr}`);
      }

      // Try to parse JSON output
      try {
        return JSON.parse(stdout);
      } catch {
        // If not JSON, return as plain output
        return {
          output: stdout,
          filesChanged: [],
          success: true,
        };
      }
    } catch (error: any) {
      this.logger.error(`Claude Code execution failed: ${error.message}`);
      throw error;
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