# Task 03: Test Git Workflow

## Objective
Validate the git branch management, commit, and push operations implemented in Sprint 7.

## Context
We need to verify:
- Branch creation per session (thread-{threadId})
- Commits with meaningful messages
- Push operations to GitHub
- Session switching and branch isolation
- Interrupt handling with auto-commits

## Test Implementation

### 1. Git Workflow Test Suite
```typescript
// scenarios/07-git-workflow.test.ts

import { Octokit } from '@octokit/rest';
import { execSync } from 'child_process';

describe('Git Workflow Integration', () => {
  let testHarness: IntegrationTestHarness;
  let github: Octokit;
  
  beforeAll(() => {
    testHarness = new IntegrationTestHarness();
    github = new Octokit({
      auth: process.env.GITHUB_TOKEN
    });
  });
  
  describe('Branch Management', () => {
    it('should create branch for new session', async () => {
      const threadId = `test-thread-${Date.now()}`;
      const session = await testHarness.createTestSession({
        clientId: 'test',
        chatThreadId: threadId,
        instruction: 'Create test file'
      });
      
      // Wait for processing
      await testHarness.waitForProcessing(session.sessionId);
      
      // Check branch exists on GitHub
      const { data: branches } = await github.repos.listBranches({
        owner: 'webordinary',
        repo: 'test-repo',
      });
      
      const branchName = `thread-${threadId}`;
      const branch = branches.find(b => b.name === branchName);
      
      expect(branch).toBeDefined();
      console.log(`✅ Branch created: ${branchName}`);
    });
    
    it('should switch branches for different sessions', async () => {
      // Create two sessions
      const session1 = await testHarness.createTestSession({
        chatThreadId: 'thread-aaa',
        instruction: 'Add file1.txt with "Session A content"'
      });
      
      const session2 = await testHarness.createTestSession({
        chatThreadId: 'thread-bbb',
        instruction: 'Add file2.txt with "Session B content"'
      });
      
      // Process both
      await testHarness.waitForProcessing(session1.sessionId);
      await testHarness.waitForProcessing(session2.sessionId);
      
      // Verify branches have correct content
      const { data: file1 } = await github.repos.getContent({
        owner: 'webordinary',
        repo: 'test-repo',
        path: 'file1.txt',
        ref: 'thread-aaa'
      });
      
      const { data: file2 } = await github.repos.getContent({
        owner: 'webordinary',
        repo: 'test-repo',
        path: 'file2.txt',
        ref: 'thread-bbb'
      });
      
      expect(file1).toBeDefined();
      expect(file2).toBeDefined();
      
      // Verify isolation - file1 shouldn't exist in thread-bbb
      await expect(github.repos.getContent({
        owner: 'webordinary',
        repo: 'test-repo',
        path: 'file1.txt',
        ref: 'thread-bbb'
      })).rejects.toThrow();
    });
  });
  
  describe('Commit Messages', () => {
    it('should create meaningful commit messages', async () => {
      const instruction = 'Add navigation menu to header';
      const session = await testHarness.createTestSession({
        instruction,
        chatThreadId: `thread-${Date.now()}`
      });
      
      await testHarness.waitForProcessing(session.sessionId);
      
      // Get commits from branch
      const { data: commits } = await github.repos.listCommits({
        owner: 'webordinary',
        repo: 'test-repo',
        sha: `thread-${session.chatThreadId}`,
        per_page: 5
      });
      
      // Find our commit
      const ourCommit = commits.find(c => 
        c.commit.message.includes('navigation') ||
        c.commit.message.includes(instruction.substring(0, 50))
      );
      
      expect(ourCommit).toBeDefined();
      expect(ourCommit?.commit.message).not.toContain('Auto-save');
      console.log(`📝 Commit message: ${ourCommit?.commit.message}`);
    });
    
    it('should include session context in commits', async () => {
      const sessionId = `session-${Date.now()}`;
      const session = await testHarness.createTestSession({
        sessionId,
        instruction: 'Test commit context'
      });
      
      await testHarness.waitForProcessing(sessionId);
      
      const { data: commits } = await github.repos.listCommits({
        owner: 'webordinary',
        repo: 'test-repo',
        sha: `thread-${session.chatThreadId}`,
        per_page: 1
      });
      
      // Check commit includes session ID (first 8 chars)
      const commitMessage = commits[0]?.commit.message || '';
      expect(commitMessage).toContain(sessionId.substring(0, 8));
    });
  });
  
  describe('Push Operations', () => {
    it('should push commits to remote', async () => {
      const threadId = `push-test-${Date.now()}`;
      const session = await testHarness.createTestSession({
        chatThreadId: threadId,
        instruction: 'Add content for push test'
      });
      
      await testHarness.waitForProcessing(session.sessionId);
      
      // Wait a bit for push to complete
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Verify commit exists on GitHub
      const { data: commits } = await github.repos.listCommits({
        owner: 'webordinary',
        repo: 'test-repo',
        sha: `thread-${threadId}`,
        per_page: 1
      });
      
      expect(commits.length).toBeGreaterThan(0);
      console.log(`📤 Pushed commit: ${commits[0].sha}`);
    });
    
    it('should handle push failures gracefully', async () => {
      // This would require simulating network failure or permission issues
      // For now, check that push failures are logged
      
      const session = await testHarness.createTestSession({
        instruction: 'Test push failure handling'
      });
      
      await testHarness.waitForProcessing(session.sessionId);
      
      // Check CloudWatch for push retry attempts
      const hasRetryLog = await testHarness.checkCloudWatchLog(
        '/ecs/webordinary/edit',
        'Push attempt.*failed',
        10000
      );
      
      // If push failed, verify commit still exists locally
      // Container should continue working despite push failure
    });
  });
  
  describe('Interrupt Handling', () => {
    it('should auto-commit when interrupted', async () => {
      const threadId = `interrupt-${Date.now()}`;
      
      // Start long-running task
      const session1 = await testHarness.createTestSession({
        chatThreadId: threadId,
        instruction: 'Create 100 test files' // Long task
      });
      
      // Wait briefly then interrupt
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Send interrupt (different session)
      const session2 = await testHarness.createTestSession({
        chatThreadId: `other-${Date.now()}`,
        instruction: 'Urgent fix'
      });
      
      // Wait for both to process
      await testHarness.waitForProcessing(session2.sessionId);
      
      // Check that interrupted session has WIP commit
      const { data: commits } = await github.repos.listCommits({
        owner: 'webordinary',
        repo: 'test-repo',
        sha: `thread-${threadId}`,
        per_page: 5
      });
      
      const wipCommit = commits.find(c => 
        c.commit.message.includes('WIP') ||
        c.commit.message.includes('Interrupted')
      );
      
      expect(wipCommit).toBeDefined();
      console.log(`⚡ Interrupt commit: ${wipCommit?.commit.message}`);
    });
    
    it('should preserve uncommitted changes when switching sessions', async () => {
      // Create session with changes
      const session1 = await testHarness.createTestSession({
        chatThreadId: 'preserve-test-1',
        instruction: 'Start making changes'
      });
      
      // Don't wait for full completion, interrupt quickly
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Switch to different session
      const session2 = await testHarness.createTestSession({
        chatThreadId: 'preserve-test-2',
        instruction: 'Different changes'
      });
      
      await testHarness.waitForProcessing(session2.sessionId);
      
      // Switch back to first session
      await testHarness.sendMessage({
        sessionId: session1.sessionId,
        chatThreadId: 'preserve-test-1',
        instruction: 'Continue work'
      });
      
      await testHarness.waitForProcessing(session1.sessionId);
      
      // Verify all changes are preserved in commits
      const { data: commits } = await github.repos.listCommits({
        owner: 'webordinary',
        repo: 'test-repo',
        sha: 'thread-preserve-test-1',
        per_page: 10
      });
      
      expect(commits.length).toBeGreaterThanOrEqual(2);
    });
  });
  
  describe('Branch History', () => {
    it('should maintain clean git history', async () => {
      const threadId = `history-${Date.now()}`;
      
      // Send multiple messages to same session
      for (let i = 0; i < 3; i++) {
        await testHarness.sendMessage({
          chatThreadId: threadId,
          instruction: `Change ${i + 1}: Update content`
        });
        
        await testHarness.waitForProcessing();
      }
      
      // Check commit history
      const { data: commits } = await github.repos.listCommits({
        owner: 'webordinary',
        repo: 'test-repo',
        sha: `thread-${threadId}`,
        per_page: 10
      });
      
      // Should have 3 commits
      expect(commits.length).toBeGreaterThanOrEqual(3);
      
      // Verify chronological order
      const timestamps = commits.map(c => 
        new Date(c.commit.author.date).getTime()
      );
      
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeLessThanOrEqual(timestamps[i - 1]);
      }
      
      console.log(`📚 Git history: ${commits.length} commits in order`);
    });
  });
});
```

### 2. Add Git Verification to Test Harness
```typescript
// src/integration-test-harness.ts

export class IntegrationTestHarness {
  
  async verifyGitBranch(branchName: string): Promise<boolean> {
    const github = new Octokit({
      auth: process.env.GITHUB_TOKEN
    });
    
    try {
      await github.repos.getBranch({
        owner: 'webordinary',
        repo: 'test-repo',
        branch: branchName
      });
      return true;
    } catch (error) {
      return false;
    }
  }
  
  async getLatestCommit(branchName: string): Promise<any> {
    const github = new Octokit({
      auth: process.env.GITHUB_TOKEN
    });
    
    const { data: commits } = await github.repos.listCommits({
      owner: 'webordinary',
      repo: 'test-repo',
      sha: branchName,
      per_page: 1
    });
    
    return commits[0];
  }
  
  async waitForGitPush(branchName: string, timeout = 30000): Promise<void> {
    await this.waitForCondition(async () => {
      return await this.verifyGitBranch(branchName);
    }, timeout);
  }
}
```

## Testing

### Run Tests
```bash
# All git tests
npm test -- --testNamePattern="Git Workflow"

# Specific scenarios
npm test -- --testNamePattern="Branch Management"
npm test -- --testNamePattern="Commit Messages"
npm test -- --testNamePattern="Interrupt Handling"
```

### Manual Verification
```bash
# Check branches on GitHub
gh repo view webordinary/test-repo --web

# Check specific branch
git fetch origin thread-test-123
git log origin/thread-test-123 --oneline

# Check commit messages
git log --grep="session" --oneline
```

## Acceptance Criteria
- [ ] Branch creation verified
- [ ] Session isolation confirmed
- [ ] Commit messages meaningful
- [ ] Push operations working
- [ ] Interrupts create commits
- [ ] Git history clean
- [ ] All tests passing

## Time Estimate
2-3 hours

## Notes
- Need GitHub token for API access
- Clean up test branches after runs
- Consider GitHub API rate limits
- May need test repository separate from production