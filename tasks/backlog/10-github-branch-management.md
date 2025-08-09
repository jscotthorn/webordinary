# Task 10: Add GitHub Branch Management for Threads

## Overview
Enhance the existing git operations from Task 04 to implement proper GitHub branch management for each conversation thread, enabling review workflows, pull request creation, and safe production deployments.

## Background
- Task 04 implemented core git operations in Claude Code container
- Current system has branch creation and push capabilities
- Need formal branch management strategy for production safety
- Existing Lambda functions can be reused for builds

## Requirements

### Branch Strategy
1. **Thread-Based Branching**
   - Each email thread gets unique branch
   - Branch naming: `thread-{threadId}-{timestamp}`
   - Automatic branch creation on session start
   - Branch cleanup after merge/abandon

2. **Pull Request Workflow**
   - Automatic PR creation after changes
   - PR description from Claude's summary
   - Link PR to email thread
   - Support for PR approval via email

3. **Protection Rules**
   - Never push directly to main/master
   - Require PR approval for production
   - Automatic staging builds on PR creation
   - Status checks before merge

4. **Integration Points**
   - Leverage existing git operations from Task 04
   - Connect with Lambda build system (Task 11)
   - Support approval UI (Task 12)
   - Enable rollback capabilities

## Technical Implementation

### 1. Enhanced Thread Manager
```typescript
// Extend existing ThreadManager from Task 04
class EnhancedThreadManager extends ThreadManager {
  async initializeThread(
    clientId: string,
    userId: string, 
    threadId: string,
    emailSubject?: string,
  ): Promise<Thread> {
    const thread = await super.initializeThread(clientId, userId, threadId);
    
    // Create feature branch
    const branchName = this.generateBranchName(threadId);
    await thread.createFeatureBranch(branchName, emailSubject);
    
    // Store branch metadata
    await this.storeBranchMetadata({
      threadId,
      branchName,
      createdAt: new Date(),
      emailSubject,
      status: 'active',
    });
    
    return thread;
  }
  
  private generateBranchName(threadId: string): string {
    const timestamp = Date.now();
    const shortId = threadId.substring(0, 8);
    return `thread-${shortId}-${timestamp}`;
  }
  
  async createPullRequest(threadId: string): Promise<PullRequestInfo> {
    const thread = this.getThread(threadId);
    const metadata = await this.getBranchMetadata(threadId);
    
    // Get changes summary from Claude
    const summary = await this.generatePRDescription(thread);
    
    // Create PR via GitHub API
    const pr = await this.githubClient.createPullRequest({
      base: 'main',
      head: metadata.branchName,
      title: `Thread: ${metadata.emailSubject || threadId}`,
      body: this.formatPRBody(summary, metadata),
      draft: false,
    });
    
    // Update metadata with PR info
    await this.updateBranchMetadata(threadId, {
      prNumber: pr.number,
      prUrl: pr.html_url,
      status: 'pending_review',
    });
    
    return {
      number: pr.number,
      url: pr.html_url,
      branch: metadata.branchName,
    };
  }
}
```

### 2. GitHub API Integration
```typescript
// New GitHub service for PR management
@Injectable()
export class GitHubService {
  private octokit: Octokit;
  
  constructor(private config: ConfigService) {
    this.octokit = new Octokit({
      auth: config.get('GITHUB_TOKEN'),
    });
  }
  
  async createPullRequest(params: CreatePRParams): Promise<PullRequest> {
    const [owner, repo] = this.parseRepository();
    
    const { data } = await this.octokit.pulls.create({
      owner,
      repo,
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base,
      draft: params.draft ?? false,
    });
    
    // Add labels
    await this.octokit.issues.addLabels({
      owner,
      repo,
      issue_number: data.number,
      labels: ['claude-generated', 'needs-review'],
    });
    
    return this.mapPullRequest(data);
  }
  
  async enableAutoMerge(prNumber: number): Promise<void> {
    const [owner, repo] = this.parseRepository();
    
    // Enable auto-merge when checks pass
    await this.octokit.graphql(`
      mutation EnableAutoMerge($pullRequestId: ID!) {
        enablePullRequestAutoMerge(input: {
          pullRequestId: $pullRequestId,
          mergeMethod: SQUASH
        }) {
          pullRequest {
            autoMergeRequest {
              enabledAt
            }
          }
        }
      }
    `, {
      pullRequestId: await this.getPullRequestNodeId(prNumber),
    });
  }
  
  async setupBranchProtection(): Promise<void> {
    const [owner, repo] = this.parseRepository();
    
    await this.octokit.repos.updateBranchProtection({
      owner,
      repo,
      branch: 'main',
      required_status_checks: {
        strict: true,
        contexts: ['build', 'test'],
      },
      enforce_admins: false,
      required_pull_request_reviews: {
        required_approving_review_count: 1,
        dismiss_stale_reviews: true,
      },
      restrictions: null,
    });
  }
}
```

### 3. Branch Metadata Storage
```typescript
// DynamoDB schema for branch tracking
interface BranchMetadata {
  threadId: string;        // Partition key
  branchName: string;     
  createdAt: Date;
  emailSubject?: string;
  status: 'active' | 'pending_review' | 'merged' | 'abandoned';
  prNumber?: number;
  prUrl?: string;
  mergedAt?: Date;
  commits: string[];
  files_changed: string[];
}

// Add to session service
class SessionService {
  async storeBranchMetadata(metadata: BranchMetadata): Promise<void> {
    await this.dynamodb.putItem({
      TableName: 'webordinary-edit-sessions',
      Item: {
        ...metadata,
        ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days
      },
    });
  }
}
```

### 4. API Endpoints
```typescript
// New branch management endpoints
@Controller('api/github')
export class GitHubController {
  @Post('/:sessionId/branch')
  async createBranch(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateBranchDto,
  ) {
    return this.githubService.createFeatureBranch(sessionId, body.name);
  }
  
  @Post('/:sessionId/pr')
  async createPullRequest(
    @Param('sessionId') sessionId: string,
    @Body() body: CreatePRDto,
  ) {
    return this.githubService.createPullRequest(sessionId, body);
  }
  
  @Get('/:sessionId/pr/status')
  async getPRStatus(@Param('sessionId') sessionId: string) {
    return this.githubService.getPullRequestStatus(sessionId);
  }
  
  @Post('/:sessionId/pr/merge')
  async mergePullRequest(
    @Param('sessionId') sessionId: string,
    @Body() body: MergePRDto,
  ) {
    return this.githubService.mergePullRequest(sessionId, body.method);
  }
}
```

### 5. Email Integration
```typescript
// Handle PR creation in email response
class EmailNotificationService {
  async sendPRCreatedNotification(
    to: string,
    prInfo: PullRequestInfo,
    changes: ChangeSummary,
  ): Promise<void> {
    const emailBody = `
      <h2>Pull Request Created</h2>
      <p>I've created a pull request with your requested changes:</p>
      
      <h3>Changes Summary:</h3>
      <ul>
        ${changes.files.map(f => `<li>${f}</li>`).join('')}
      </ul>
      
      <h3>Review Your Changes:</h3>
      <p>
        <a href="${prInfo.url}" style="button">View Pull Request on GitHub</a>
      </p>
      
      <h3>Preview Site:</h3>
      <p>
        <a href="https://edit.ameliastamps.com/session/${prInfo.sessionId}/">
          View Live Preview
        </a>
      </p>
      
      <p>Reply with "approve" to merge these changes to production.</p>
    `;
    
    await this.ses.sendEmail({
      To: [to],
      Subject: `PR #${prInfo.number}: ${changes.summary}`,
      HtmlBody: emailBody,
    });
  }
}
```

## Implementation Steps

### Phase 1: Branch Strategy Implementation
1. Extend ThreadManager with branch creation
2. Implement branch naming conventions
3. Add metadata storage in DynamoDB
4. Test branch creation flow

### Phase 2: GitHub API Integration
1. Set up Octokit client with authentication
2. Implement PR creation logic
3. Add branch protection rules
4. Configure auto-merge capabilities

### Phase 3: Workflow Integration
1. Connect branch creation to session initialization
2. Auto-create PR after first commit
3. Link PR status to email notifications
4. Implement approval handling

### Phase 4: Safety Features
1. Implement branch protection for main
2. Add status checks integration
3. Create rollback mechanism
4. Add cleanup for old branches

## Branch Lifecycle

### Creation Flow
```
Email Received → Session Created → Feature Branch Created → Work Begins
```

### Review Flow
```
Changes Made → Auto-commit → PR Created → Email Notification → Approval
```

### Merge Flow
```
Approval Received → Checks Pass → Auto-merge → Deploy → Cleanup Branch
```

## Success Criteria

### Functional Requirements
- [ ] Automatic branch creation per thread
- [ ] PR creation with proper descriptions
- [ ] Email notifications with PR links
- [ ] Branch protection enforced
- [ ] Auto-merge on approval

### Safety Requirements
- [ ] No direct pushes to main
- [ ] All changes go through PR
- [ ] Status checks must pass
- [ ] Rollback capability available
- [ ] Branch cleanup after merge

### Integration Requirements
- [ ] Works with existing git operations
- [ ] Connects to Lambda builds
- [ ] Supports approval workflow
- [ ] Maintains thread context

## Testing Plan

### Unit Testing
```bash
# Test branch creation
npm test github.service.spec.ts
npm test branch-manager.spec.ts
```

### Integration Testing
```bash
# Create test thread and branch
curl -X POST $API_URL/api/sessions/activate \
  -d '{"email": "test@example.com", "threadId": "test-123"}'

# Verify branch created
git ls-remote origin | grep thread-test-123

# Create PR
curl -X POST $API_URL/api/github/test-session/pr

# Check PR status
gh pr view --json state,mergeable
```

## Security Considerations

### Token Management
- GitHub token stored in Secrets Manager
- Least privilege access (repo, write:pr)
- Token rotation schedule

### Branch Protection
- Require PR reviews for production
- Dismiss stale reviews
- Require up-to-date branches
- Status checks mandatory

## Rollback Strategy
1. Keep last 5 PR branches for quick revert
2. Tag each production deployment
3. One-click revert via email command
4. Automatic rollback on failed deploys

## Dependencies
- Task 04 git operations complete
- GitHub token with appropriate permissions
- DynamoDB session table available
- Email notification system working

## Estimated Timeline
- Branch Strategy: 3 hours
- GitHub API Integration: 4 hours
- Workflow Integration: 3 hours
- Testing & Safety: 2 hours
- **Total: 1.5 days**

## Future Enhancements
- Multiple PR reviewers support
- Draft PR for large changes
- Automatic conflict resolution
- PR templates based on change type
- Integration with GitHub Actions

## Notes
- Use GitHub's GraphQL API for advanced features
- Consider GitHub Apps for better rate limits
- Document branch naming conventions clearly
- Plan for parallel PR support per client