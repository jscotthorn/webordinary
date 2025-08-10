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
    
    try {
      // Execute using Claude Code CLI
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