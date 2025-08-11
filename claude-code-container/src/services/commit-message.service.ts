import { Injectable } from '@nestjs/common';

@Injectable()
export class CommitMessageService {
  
  /**
   * Generate commit message from Claude operation
   */
  generateCommitMessage(context: {
    instruction?: string;
    command?: string;
    filesChanged?: string[];
    sessionId?: string;
    userId?: string;
    interrupted?: boolean;
  }): string {
    // Handle interruption case
    if (context.interrupted) {
      return this.generateInterruptMessage(context);
    }
    
    // Extract action from instruction
    const action = this.extractAction(context.instruction || context.command);
    
    // Build commit message parts
    const parts: string[] = [];
    
    // Add action
    if (action) {
      parts.push(action);
    }
    
    // Add file context if available
    if (context.filesChanged && context.filesChanged.length > 0) {
      const fileContext = this.summarizeFiles(context.filesChanged);
      if (fileContext) parts.push(`(${fileContext})`);
    }
    
    // Add session context
    const sessionTag = this.formatSessionTag(context.sessionId);
    if (sessionTag) parts.push(sessionTag);
    
    // Fallback if no parts
    if (parts.length === 0) {
      parts.push('Update via Claude');
    }
    
    return this.truncateMessage(parts.join(' '), 72);
  }
  
  private extractAction(instruction?: string): string {
    if (!instruction) return 'Update';
    
    // Clean up the instruction
    let action = instruction.trim();
    
    // Remove common prefixes
    const prefixes = [
      'please ', 'can you ', 'could you ', 'i need to ', 'i want to ',
      'let\'s ', 'help me ', 'assist with '
    ];
    
    for (const prefix of prefixes) {
      if (action.toLowerCase().startsWith(prefix)) {
        action = action.substring(prefix.length);
        break;
      }
    }
    
    // Capitalize first letter
    action = action.charAt(0).toUpperCase() + action.slice(1);
    
    // Common replacements for better messages
    const replacements: Record<string, string> = {
      'fix': 'Fix',
      'add': 'Add',
      'remove': 'Remove',
      'update': 'Update',
      'create': 'Create',
      'delete': 'Delete',
      'refactor': 'Refactor',
      'implement': 'Implement',
      'change': 'Change',
      'modify': 'Modify',
    };
    
    // Check if instruction starts with a common verb
    const firstWord = action.split(' ')[0].toLowerCase();
    if (replacements[firstWord]) {
      action = replacements[firstWord] + action.slice(firstWord.length);
    }
    
    return action;
  }
  
  private summarizeFiles(files: string[]): string {
    if (files.length === 0) return '';
    if (files.length === 1) {
      // Single file - use basename
      const parts = files[0].split('/');
      return parts[parts.length - 1];
    }
    
    // Multiple files - try to find common pattern
    const extensions = new Set(files.map(f => {
      const ext = f.split('.').pop();
      return ext;
    }));
    
    if (extensions.size === 1) {
      return `${files.length} ${extensions.values().next().value} files`;
    }
    
    // Check for common directories
    const dirs = files.map(f => f.split('/').slice(0, -1).join('/'));
    const uniqueDirs = new Set(dirs);
    
    if (uniqueDirs.size === 1) {
      const dir = dirs[0].split('/').pop() || 'files';
      return `${files.length} files in ${dir}`;
    }
    
    return `${files.length} files`;
  }
  
  private formatSessionTag(sessionId?: string): string {
    if (!sessionId) return '';
    // Use first 8 chars of session ID
    return `[${sessionId.substring(0, 8)}]`;
  }
  
  private generateInterruptMessage(context: any): string {
    const sessionTag = this.formatSessionTag(context.sessionId);
    const fileCount = context.filesChanged?.length || 0;
    
    if (fileCount > 0) {
      return `WIP: Interrupted with ${fileCount} file(s) modified ${sessionTag}`;
    }
    return `WIP: Session interrupted ${sessionTag}`;
  }
  
  private truncateMessage(message: string, maxLength: number): string {
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength - 3) + '...';
  }
  
  /**
   * Generate extended commit body with details
   */
  generateCommitBody(context: {
    instruction?: string;
    filesChanged?: string[];
    sessionId?: string;
    userId?: string;
    timestamp?: number;
  }): string {
    const lines: string[] = [];
    
    // Add full instruction if truncated in subject
    if (context.instruction && context.instruction.length > 72) {
      lines.push('Full instruction:');
      lines.push(this.wrapText(context.instruction, 72));
      lines.push('');
    }
    
    // Add file list if many files
    if (context.filesChanged && context.filesChanged.length > 3) {
      lines.push('Files changed:');
      context.filesChanged.forEach(file => {
        lines.push(`  - ${file}`);
      });
      lines.push('');
    }
    
    // Add metadata
    lines.push('---');
    if (context.sessionId) lines.push(`Session: ${context.sessionId}`);
    if (context.userId) lines.push(`User: ${context.userId}`);
    if (context.timestamp) {
      lines.push(`Time: ${new Date(context.timestamp).toISOString()}`);
    }
    lines.push('Generated by Claude Code Container');
    
    return lines.join('\n');
  }
  
  private wrapText(text: string, width: number): string {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    
    for (const word of words) {
      if (currentLine.length + word.length + 1 > width) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = currentLine ? `${currentLine} ${word}` : word;
      }
    }
    
    if (currentLine) lines.push(currentLine);
    return lines.join('\n');
  }
}