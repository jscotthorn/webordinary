# Task 04: Handle Git Conflicts and Edge Cases

## Objective
Add robust error handling for git operations, especially when switching between sessions with uncommitted changes or conflicts.

## Context
Current implementation assumes git operations always succeed. We need to handle:
- Uncommitted changes when switching branches
- Merge conflicts
- Diverged branches
- Failed pushes due to upstream changes

## Scenarios to Handle

### 1. Uncommitted Changes When Switching
```typescript
// In git.service.ts

async safeBranchSwitch(targetBranch: string): Promise<boolean> {
  try {
    // Check for uncommitted changes
    const hasChanges = await this.hasUncommittedChanges();
    
    if (hasChanges) {
      this.logger.log('Uncommitted changes detected, stashing...');
      
      // Stash changes with descriptive message
      const stashMessage = `Auto-stash before switching to ${targetBranch}`;
      await execAsync(`git stash push -m "${stashMessage}"`, {
        cwd: this.workspacePath
      });
    }
    
    // Try to checkout branch
    try {
      await execAsync(`git checkout ${targetBranch}`, {
        cwd: this.workspacePath
      });
    } catch (checkoutError: any) {
      // Branch doesn't exist, create it
      if (checkoutError.message.includes('did not match any')) {
        await execAsync(`git checkout -b ${targetBranch}`, {
          cwd: this.workspacePath
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
          cwd: this.workspacePath
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
```

### 2. Handle Merge Conflicts
```typescript
// In git.service.ts

async resolveConflictsAutomatically(): Promise<boolean> {
  try {
    // Check if we're in a conflict state
    const { stdout: status } = await execAsync('git status --porcelain', {
      cwd: this.workspacePath
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
      await execAsync(`git checkout --ours ${file}`, {
        cwd: this.workspacePath
      });
      await execAsync(`git add ${file}`, {
        cwd: this.workspacePath
      });
    }
    
    // Commit the resolution
    await execAsync('git commit -m "Auto-resolved conflicts (kept local changes)"', {
      cwd: this.workspacePath
    });
    
    this.logger.log('Conflicts auto-resolved using local version');
    return true;
  } catch (error: any) {
    this.logger.error(`Failed to resolve conflicts: ${error.message}`);
    return false;
  }
}
```

### 3. Handle Push Conflicts
```typescript
// In git.service.ts

async safePush(branch?: string): Promise<boolean> {
  try {
    const currentBranch = branch || await this.getCurrentBranch();
    
    // First attempt direct push
    try {
      await execAsync(`git push origin ${currentBranch}`, {
        cwd: this.workspacePath
      });
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

private async handleNonFastForward(branch: string): Promise<boolean> {
  this.logger.log('Remote has changes, attempting to merge...');
  
  try {
    // Pull with rebase to keep history clean
    await execAsync(`git pull --rebase origin ${branch}`, {
      cwd: this.workspacePath
    });
    
    // Try push again
    await execAsync(`git push origin ${branch}`, {
      cwd: this.workspacePath
    });
    
    this.logger.log('Successfully pushed after rebase');
    return true;
  } catch (rebaseError: any) {
    if (rebaseError.message.includes('conflict')) {
      // Abort rebase and try merge instead
      await execAsync('git rebase --abort', {
        cwd: this.workspacePath
      }).catch(() => {}); // Ignore abort errors
      
      // Try merge strategy
      try {
        await execAsync(`git pull origin ${branch}`, {
          cwd: this.workspacePath
        });
        
        // Resolve any conflicts
        await this.resolveConflictsAutomatically();
        
        // Push merged result
        await execAsync(`git push origin ${branch}`, {
          cwd: this.workspacePath
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
```

### 4. Update Message Processor
```typescript
// In message-processor.service.ts

private async switchToSession(sessionId: string, chatThreadId: string): Promise<void> {
  const branch = `thread-${chatThreadId}`;
  
  // Commit current changes if any
  if (this.currentSessionId) {
    await this.gitService.autoCommitChanges('Switching sessions');
  }
  
  // Use safe branch switch
  const switchSuccess = await this.gitService.safeBranchSwitch(branch);
  
  if (!switchSuccess) {
    // Fall back to force checkout (data loss possible)
    this.logger.warn('Safe switch failed, forcing checkout...');
    await execAsync(`git checkout -f ${branch}`, {
      cwd: process.env.WORKSPACE_PATH
    }).catch(async () => {
      // Create branch if doesn't exist
      await execAsync(`git checkout -b ${branch}`, {
        cwd: process.env.WORKSPACE_PATH
      });
    });
  }
  
  this.currentSessionId = sessionId;
  this.logger.log(`Switched to session ${sessionId} (branch: ${branch})`);
}

private async executeCompleteWorkflow(message: any): Promise<any> {
  // ... existing workflow ...
  
  // Step 5: Safe push with conflict handling
  this.logger.log('Pushing to GitHub...');
  const pushSuccess = await this.gitService.safePush();
  
  if (!pushSuccess) {
    this.logger.warn('Push failed but workflow continues');
    // Queue for later retry or notify user
  }
  
  return result;
}
```

### 5. Add Recovery Mechanisms
```typescript
// In git.service.ts

async recoverRepository(): Promise<void> {
  this.logger.log('Attempting repository recovery...');
  
  try {
    // Check if we're in the middle of a merge/rebase
    const { stdout: gitDir } = await execAsync('git rev-parse --git-dir', {
      cwd: this.workspacePath
    });
    
    // Abort any in-progress operations
    await execAsync('git merge --abort', { cwd: this.workspacePath }).catch(() => {});
    await execAsync('git rebase --abort', { cwd: this.workspacePath }).catch(() => {});
    await execAsync('git cherry-pick --abort', { cwd: this.workspacePath }).catch(() => {});
    
    // Reset to clean state if needed
    const { stdout: status } = await execAsync('git status --porcelain', {
      cwd: this.workspacePath
    });
    
    if (status.includes('UU ')) {
      // Unresolved conflicts, reset to HEAD
      await execAsync('git reset --hard HEAD', {
        cwd: this.workspacePath
      });
      this.logger.warn('Reset repository to HEAD due to conflicts');
    }
    
    this.logger.log('Repository recovered');
  } catch (error: any) {
    this.logger.error(`Recovery failed: ${error.message}`);
    throw error;
  }
}
```

## Testing Scenarios

### 1. Uncommitted Changes
```bash
# Make changes without committing
echo "test" > test.txt
# Send message to switch session
# Verify changes are stashed and reapplied
```

### 2. Push Conflicts
```bash
# Push changes from another source
# Send message that tries to push
# Verify automatic rebase/merge
```

### 3. Corrupt State
```bash
# Simulate merge conflict state
# Send new message
# Verify recovery mechanisms work
```

## Acceptance Criteria
- [ ] Branch switches preserve uncommitted work
- [ ] Push conflicts are resolved automatically
- [ ] Merge conflicts handled gracefully
- [ ] Repository can recover from bad states
- [ ] No data loss during operations
- [ ] Clear logging of conflict resolution

## Time Estimate
2-3 hours

## Notes
- Prioritize data preservation over speed
- Log all automatic resolutions for audit
- Consider adding manual intervention webhooks
- Test with various git states