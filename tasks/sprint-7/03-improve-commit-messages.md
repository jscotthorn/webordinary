# Task 03: Improve Commit Messages

## Objective
Generate meaningful commit messages from Claude operations and user instructions instead of generic "Auto-save" messages.

## Context
Current commit messages are generic. We need to extract meaningful context from the Claude instruction and session data to create useful git history.

## Current State
- Auto-commits use: "Auto-save: {reason}"
- No context about what Claude actually did
- No user/session attribution

## Implementation

### 1. Create Commit Message Service
```typescript
// New file: src/services/commit-message.service.ts

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
```

### 2. Update Message Processor
```typescript
// In message-processor.service.ts

import { CommitMessageService } from './services/commit-message.service';

constructor(
  // ... existing services
  private readonly commitMessageService: CommitMessageService,
) {}

private async executeCompleteWorkflow(message: any): Promise<any> {
  // ... existing code
  
  // Step 2: Commit changes with better message
  if (result.filesChanged.length > 0) {
    const commitContext = {
      instruction: message.instruction,
      command: message.command,
      filesChanged: result.filesChanged,
      sessionId: message.sessionId,
      userId: message.userId,
      timestamp: Date.now(),
    };
    
    const commitMessage = this.commitMessageService.generateCommitMessage(commitContext);
    const commitBody = this.commitMessageService.generateCommitBody(commitContext);
    
    // Use both subject and body
    await this.gitService.commitWithBody(commitMessage, commitBody);
  }
  
  // ... rest of workflow
}
```

### 3. Update Git Service for Commit Body
```typescript
// In git.service.ts

async commitWithBody(subject: string, body?: string): Promise<void> {
  try {
    let commitCommand: string;
    
    if (body) {
      // Use -F to read from stdin for multi-line commits
      const fullMessage = `${subject}\n\n${body}`;
      commitCommand = `echo "${fullMessage.replace(/"/g, '\\"')}" | git commit -F -`;
    } else {
      commitCommand = `git commit -m "${subject}"`;
    }
    
    await execAsync(commitCommand, { cwd: this.workspacePath });
    this.logger.log(`Committed: ${subject}`);
  } catch (error: any) {
    this.logger.error(`Failed to commit: ${error.message}`);
    throw error;
  }
}
```

### 4. Example Commit Messages

#### Before:
```
Auto-save: Interrupted by new message
Auto-save: Switching sessions
Auto-save: Claude changes
```

#### After:
```
Add navigation menu to homepage [a1b2c3d4]
Fix responsive layout issues in header (3 CSS files) [a1b2c3d4]
Update contact form validation [a1b2c3d4]
WIP: Interrupted with 2 file(s) modified [a1b2c3d4]
Implement user authentication (12 files) [a1b2c3d4]
```

#### With commit body:
```
Update homepage hero section [a1b2c3d4]

Full instruction:
Update the homepage hero section to include a new call-to-action
button that links to the contact page and make the background
image more prominent

Files changed:
  - src/pages/index.astro
  - src/components/Hero.astro
  - src/styles/hero.css

---
Session: a1b2c3d4-e5f6-7890-abcd-ef1234567890
User: user@example.com
Time: 2024-01-15T10:30:00Z
Generated by Claude Code Container
```

## Testing

### Test Cases
1. **Simple instruction**: "fix typo" → "Fix typo"
2. **Complex instruction**: "please help me add a new..." → "Add a new..."
3. **Multiple files**: Changes to 5 files → "Update (5 files)"
4. **Interruption**: Interrupted during work → "WIP: Interrupted..."
5. **No instruction**: Empty message → "Update via Claude"

## Acceptance Criteria
- [ ] Commit messages reflect actual changes
- [ ] Session ID included for tracking
- [ ] File context when relevant
- [ ] Proper capitalization and grammar
- [ ] Extended body for complex changes
- [ ] Truncation to Git standards (72 chars for subject)

## Time Estimate
1-2 hours

## Notes
- Follow Git commit message conventions
- Subject line max 72 characters
- Body wrapped at 72 characters
- Empty line between subject and body
- Consider adding emoji prefixes in future (🐛 fix, ✨ feature, etc.)