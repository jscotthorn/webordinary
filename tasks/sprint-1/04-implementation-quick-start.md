# Task 04: Git Operations Quick Implementation Guide

## Priority 1: Essential Git Operations (Implement First)

### 1. Setup Git Authentication in Container

```bash
# In entrypoint.sh
#!/bin/bash

# Configure git with token
git config --global credential.helper store
echo "https://${GITHUB_TOKEN}@github.com" > ~/.git-credentials

# Set user info
git config --global user.email "claude@webordinary.com"
git config --global user.name "Claude Code Bot"

# Set safe directory (for container operations)
git config --global --add safe.directory /workspace
```

### 2. Core Push/Pull Operations

```typescript
// Add to thread-manager.ts
async pushToRemote(projectPath: string, branch: string): Promise<void> {
  // Never push to main
  if (branch === 'main' || branch === 'master') {
    throw new Error('Cannot push to protected branch');
  }
  
  // Push with upstream set
  await execAsync(`cd ${projectPath} && git push -u origin ${branch}`);
}

async pullFromRemote(projectPath: string, branch: string): Promise<void> {
  // Fetch first to get latest refs
  await execAsync(`cd ${projectPath} && git fetch origin`);
  
  // Pull with rebase to avoid merge commits
  await execAsync(`cd ${projectPath} && git pull --rebase origin ${branch}`);
}
```

### 3. Smart Commit with Auto-Push

```typescript
async commitAndPush(
  projectPath: string,
  message: string,
  threadId: string,
  autoPush = true
): Promise<{ commitId: string; pushed: boolean; prUrl?: string }> {
  // Add all changes
  await execAsync(`cd ${projectPath} && git add -A`);
  
  // Commit with thread ID
  const fullMessage = `${message}\n\nThread-ID: ${threadId}`;
  await execAsync(`cd ${projectPath} && git commit -m "${fullMessage}"`);
  
  // Get commit hash
  const { stdout: commitId } = await execAsync(
    `cd ${projectPath} && git rev-parse HEAD`
  );
  
  // Get current branch
  const { stdout: branch } = await execAsync(
    `cd ${projectPath} && git branch --show-current`
  );
  
  let pushed = false;
  let prUrl;
  
  if (autoPush && branch.trim() !== 'main' && branch.trim() !== 'master') {
    try {
      await this.pushToRemote(projectPath, branch.trim());
      pushed = true;
      
      // Generate PR URL
      const { stdout: remoteUrl } = await execAsync(
        `cd ${projectPath} && git remote get-url origin`
      );
      
      const match = remoteUrl.match(/github\.com[:/]([\w-]+)\/([\w-]+)/);
      if (match) {
        const [, owner, repo] = match;
        prUrl = `https://github.com/${owner}/${repo.replace('.git', '')}/compare/main...${branch.trim()}?expand=1`;
      }
    } catch (error) {
      console.error('Failed to push:', error);
    }
  }
  
  return {
    commitId: commitId.trim(),
    pushed,
    prUrl,
  };
}
```

## Priority 2: Status and Sync Operations

### 4. Check Remote Status

```typescript
async getRemoteStatus(projectPath: string): Promise<{
  ahead: number;
  behind: number;
  branch: string;
  hasUnpushedCommits: boolean;
  hasRemoteChanges: boolean;
}> {
  // Fetch latest refs
  await execAsync(`cd ${projectPath} && git fetch origin`);
  
  // Get current branch
  const { stdout: branch } = await execAsync(
    `cd ${projectPath} && git branch --show-current`
  );
  
  // Count commits ahead/behind
  const { stdout: ahead } = await execAsync(
    `cd ${projectPath} && git rev-list --count origin/${branch.trim()}..HEAD`
  );
  
  const { stdout: behind } = await execAsync(
    `cd ${projectPath} && git rev-list --count HEAD..origin/${branch.trim()}`
  );
  
  return {
    ahead: parseInt(ahead.trim()) || 0,
    behind: parseInt(behind.trim()) || 0,
    branch: branch.trim(),
    hasUnpushedCommits: parseInt(ahead.trim()) > 0,
    hasRemoteChanges: parseInt(behind.trim()) > 0,
  };
}
```

### 5. Safe Branch Switching

```typescript
async switchBranch(
  projectPath: string,
  targetBranch: string,
  createNew = false
): Promise<void> {
  // Check for uncommitted changes
  const { stdout: status } = await execAsync(
    `cd ${projectPath} && git status --porcelain`
  );
  
  if (status.trim()) {
    // Stash changes
    await execAsync(`cd ${projectPath} && git stash push -m "Auto-stash before branch switch"`);
  }
  
  if (createNew) {
    // Create and switch to new branch
    await execAsync(`cd ${projectPath} && git checkout -b ${targetBranch}`);
  } else {
    // Fetch and switch
    await execAsync(`cd ${projectPath} && git fetch origin ${targetBranch}`);
    await execAsync(`cd ${projectPath} && git checkout ${targetBranch}`);
  }
  
  // Apply stash if exists
  try {
    await execAsync(`cd ${projectPath} && git stash pop`);
  } catch {
    // No stash to pop
  }
}
```

## Priority 3: PR Creation (If gh CLI available)

### 6. Create Pull Request

```typescript
async createPR(
  projectPath: string,
  title: string,
  body: string
): Promise<{ prUrl?: string; success: boolean }> {
  try {
    // Check if gh CLI exists
    await execAsync('which gh');
    
    // Create PR
    const { stdout } = await execAsync(
      `cd ${projectPath} && gh pr create --title "${title}" --body "${body}" --base main`
    );
    
    // Extract PR URL
    const urlMatch = stdout.match(/https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+/);
    
    return {
      prUrl: urlMatch ? urlMatch[0] : undefined,
      success: true,
    };
  } catch {
    // gh CLI not available, return URL for manual creation
    const { stdout: branch } = await execAsync(
      `cd ${projectPath} && git branch --show-current`
    );
    
    const { stdout: remoteUrl } = await execAsync(
      `cd ${projectPath} && git remote get-url origin`
    );
    
    const match = remoteUrl.match(/github\.com[:/]([\w-]+)\/([\w-]+)/);
    if (match) {
      const [, owner, repo] = match;
      return {
        prUrl: `https://github.com/${owner}/${repo.replace('.git', '')}/compare/main...${branch.trim()}?expand=1`,
        success: false,
      };
    }
    
    return { success: false };
  }
}
```

## Environment Variables Required

```bash
# Minimum required
GITHUB_TOKEN=ghp_xxxxxxxxxxxx         # Personal access token with repo scope
GIT_AUTO_PUSH=true                    # Enable automatic push after commits

# Optional but recommended
GIT_DEFAULT_BRANCH=main               # Default branch name
GIT_USER_NAME="Claude Code Bot"       # Git commit author name
GIT_USER_EMAIL="claude@webordinary.com" # Git commit author email
```

## Quick Test Script

```bash
#!/bin/bash
# test-git-ops.sh

# Test authentication
echo "Testing GitHub authentication..."
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user

# Test git operations
cd /workspace/test-client/test-user/project

# Test commit and push
echo "test" > test-file.txt
git add test-file.txt
git commit -m "Test commit"
git push -u origin thread-test

echo "Git operations test complete!"
```

## Integration with Claude Code SDK

When Claude Code performs operations, it should:

1. **Always work on feature branches** (never on main)
2. **Commit frequently** with descriptive messages
3. **Push automatically** to create backup and enable PR creation
4. **Include thread ID** in commit messages for traceability
5. **Generate PR links** in responses to users

Example workflow:
```typescript
// In Claude Code execution
const result = await threadManager.commitAndPush(
  workspace.projectPath,
  "Updated homepage content as requested",
  threadId,
  true // auto-push
);

if (result.pushed && result.prUrl) {
  return `Changes committed and pushed. Create a pull request: ${result.prUrl}`;
}
```

## Security Checklist

- [ ] GitHub token has minimum required scopes (repo, read:user)
- [ ] Token is stored in environment variable only
- [ ] Protected branches list includes main/master/production
- [ ] Git credentials file is not committed
- [ ] Push operations check branch protection
- [ ] All operations are logged for audit
- [ ] Token validation happens on container startup

## Next Steps

1. Implement Priority 1 operations first (auth, push/pull, commit)
2. Test with a real GitHub repository
3. Add Priority 2 operations (status, branch switching)
4. Integrate with Claude Code SDK responses
5. Add PR creation if gh CLI is available