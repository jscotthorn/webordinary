# Task 12: Plan Approval UI (Email-Based)

## Overview
Implement an HTML email-based approval interface that allows users to review and approve/reject Claude Code's proposed changes before they are executed, providing a safety gate for significant modifications.

## Background
- Task 09 simplified Hermes to detect when approval is needed
- Task 10 provides PR creation for review
- Users need clear visibility into proposed changes
- Email is the primary communication channel

## Requirements

### Core Features
1. **Rich HTML Email Interface**
   - Clear presentation of proposed changes
   - Visual diff of modifications
   - One-click approve/reject buttons
   - Mobile-responsive design

2. **Approval Token System**
   - Secure, time-limited tokens
   - One-time use validation
   - Link to specific session/plan
   - Prevent replay attacks

3. **Plan Presentation**
   - Structured change summary
   - File-by-file breakdown
   - Before/after comparisons
   - Risk assessment indicators

4. **Approval Workflow**
   - Email sent when approval needed
   - Click handling via API endpoint
   - Confirmation of action taken
   - Fallback to reply-based approval

## Technical Implementation

### 1. Approval Detection in Claude Code
```typescript
// In Claude Code container
interface ExecutionPlan {
  requiresApproval: boolean;
  approvalReason?: 'destructive' | 'large_scope' | 'production' | 'cost';
  changes: {
    file: string;
    action: 'create' | 'modify' | 'delete';
    linesAdded: number;
    linesRemoved: number;
    preview?: string;
  }[];
  estimatedImpact: 'low' | 'medium' | 'high';
  summary: string;
}

class ClaudeExecutor {
  async analyzePlan(instruction: string): Promise<ExecutionPlan> {
    const plan = await this.claude.planExecution(instruction);
    
    // Determine if approval needed
    const requiresApproval = 
      plan.changes.some(c => c.action === 'delete') ||
      plan.changes.length > 10 ||
      plan.estimatedImpact === 'high' ||
      instruction.toLowerCase().includes('production');
    
    return {
      requiresApproval,
      approvalReason: this.determineReason(plan),
      changes: plan.changes,
      estimatedImpact: plan.estimatedImpact,
      summary: plan.summary,
    };
  }
}
```

### 2. HTML Email Template
```typescript
// Email template generator
class ApprovalEmailGenerator {
  generateApprovalEmail(
    plan: ExecutionPlan,
    approvalToken: string,
    sessionId: string,
  ): string {
    const approveUrl = `${this.baseUrl}/api/approve/${approvalToken}`;
    const rejectUrl = `${this.baseUrl}/api/reject/${approvalToken}`;
    const previewUrl = `${this.baseUrl}/session/${sessionId}/`;
    
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 30px;
          border-radius: 10px 10px 0 0;
          text-align: center;
        }
        .content {
          background: #f7f7f7;
          padding: 30px;
          border-radius: 0 0 10px 10px;
        }
        .change-summary {
          background: white;
          border-left: 4px solid #667eea;
          padding: 15px;
          margin: 20px 0;
          border-radius: 5px;
        }
        .file-change {
          display: flex;
          justify-content: space-between;
          padding: 10px;
          margin: 5px 0;
          background: white;
          border-radius: 5px;
        }
        .action-create { border-left: 3px solid #10b981; }
        .action-modify { border-left: 3px solid #3b82f6; }
        .action-delete { border-left: 3px solid #ef4444; }
        .stats {
          display: flex;
          gap: 20px;
          justify-content: center;
          margin: 20px 0;
        }
        .stat {
          text-align: center;
          padding: 10px;
        }
        .stat-number {
          font-size: 24px;
          font-weight: bold;
          color: #667eea;
        }
        .buttons {
          display: flex;
          gap: 20px;
          justify-content: center;
          margin: 30px 0;
        }
        .btn {
          padding: 15px 40px;
          text-decoration: none;
          border-radius: 5px;
          font-weight: bold;
          display: inline-block;
          text-align: center;
        }
        .btn-approve {
          background: #10b981;
          color: white;
        }
        .btn-reject {
          background: #ef4444;
          color: white;
        }
        .btn-preview {
          background: #3b82f6;
          color: white;
        }
        .impact-badge {
          display: inline-block;
          padding: 5px 10px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: bold;
        }
        .impact-low { background: #d1fae5; color: #065f46; }
        .impact-medium { background: #fed7aa; color: #92400e; }
        .impact-high { background: #fee2e2; color: #991b1b; }
        .code-preview {
          background: #1e1e1e;
          color: #d4d4d4;
          padding: 15px;
          border-radius: 5px;
          font-family: 'Courier New', monospace;
          font-size: 14px;
          overflow-x: auto;
          margin: 10px 0;
        }
        .diff-add { color: #10b981; }
        .diff-remove { color: #ef4444; }
        @media (max-width: 600px) {
          .buttons { flex-direction: column; }
          .btn { width: 100%; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🤖 Approval Required</h1>
        <p>Claude has prepared changes that need your review</p>
      </div>
      
      <div class="content">
        <div class="change-summary">
          <h2>Summary</h2>
          <p>${plan.summary}</p>
          <p>
            <span class="impact-badge impact-${plan.estimatedImpact}">
              ${plan.estimatedImpact.toUpperCase()} IMPACT
            </span>
          </p>
        </div>
        
        <div class="stats">
          <div class="stat">
            <div class="stat-number">${plan.changes.length}</div>
            <div>Files Changed</div>
          </div>
          <div class="stat">
            <div class="stat-number">
              +${plan.changes.reduce((sum, c) => sum + c.linesAdded, 0)}
            </div>
            <div>Lines Added</div>
          </div>
          <div class="stat">
            <div class="stat-number">
              -${plan.changes.reduce((sum, c) => sum + c.linesRemoved, 0)}
            </div>
            <div>Lines Removed</div>
          </div>
        </div>
        
        <h3>Proposed Changes:</h3>
        ${plan.changes.map(change => `
          <div class="file-change action-${change.action}">
            <div>
              <strong>${change.file}</strong>
              <br>
              <small>${change.action.toUpperCase()}</small>
            </div>
            <div>
              <span class="diff-add">+${change.linesAdded}</span> / 
              <span class="diff-remove">-${change.linesRemoved}</span>
            </div>
          </div>
          ${change.preview ? `
            <div class="code-preview">
              ${this.formatCodePreview(change.preview)}
            </div>
          ` : ''}
        `).join('')}
        
        <div class="buttons">
          <a href="${approveUrl}" class="btn btn-approve">
            ✅ Approve Changes
          </a>
          <a href="${rejectUrl}" class="btn btn-reject">
            ❌ Reject Changes
          </a>
        </div>
        
        <div style="text-align: center; margin: 20px 0;">
          <a href="${previewUrl}" class="btn btn-preview">
            👁️ View Live Preview
          </a>
        </div>
        
        <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
        
        <p style="color: #666; font-size: 14px;">
          <strong>Alternative:</strong> Reply to this email with "approve" or "reject"
        </p>
        
        <p style="color: #666; font-size: 12px;">
          This approval link expires in 24 hours. Token: ${approvalToken.substring(0, 8)}...
        </p>
      </div>
    </body>
    </html>
    `;
  }
  
  private formatCodePreview(preview: string): string {
    return preview
      .split('\n')
      .map(line => {
        if (line.startsWith('+')) {
          return `<span class="diff-add">${this.escapeHtml(line)}</span>`;
        } else if (line.startsWith('-')) {
          return `<span class="diff-remove">${this.escapeHtml(line)}</span>`;
        }
        return this.escapeHtml(line);
      })
      .join('\n');
  }
}
```

### 3. Approval Token Management
```typescript
// Secure token system
@Injectable()
export class ApprovalTokenService {
  async createApprovalToken(
    sessionId: string,
    plan: ExecutionPlan,
  ): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    
    // Store in DynamoDB with TTL
    await this.dynamodb.putItem({
      TableName: 'webordinary-approval-tokens',
      Item: {
        token: hashedToken,
        sessionId,
        plan: JSON.stringify(plan),
        createdAt: Date.now(),
        ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
        status: 'pending',
      },
    });
    
    return token;
  }
  
  async validateAndConsumeToken(
    token: string,
  ): Promise<ApprovalTokenData> {
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    
    // Get token data
    const result = await this.dynamodb.getItem({
      TableName: 'webordinary-approval-tokens',
      Key: { token: hashedToken },
    });
    
    if (!result.Item || result.Item.status !== 'pending') {
      throw new Error('Invalid or expired token');
    }
    
    // Mark as used
    await this.dynamodb.updateItem({
      TableName: 'webordinary-approval-tokens',
      Key: { token: hashedToken },
      UpdateExpression: 'SET #status = :status, usedAt = :usedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'used',
        ':usedAt': Date.now(),
      },
    });
    
    return {
      sessionId: result.Item.sessionId,
      plan: JSON.parse(result.Item.plan),
    };
  }
}
```

### 4. Approval API Endpoints
```typescript
// Handle approval/rejection clicks
@Controller('api')
export class ApprovalController {
  @Get('approve/:token')
  async handleApproval(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      const tokenData = await this.tokenService.validateAndConsumeToken(token);
      
      // Execute the approved plan
      await this.claudeExecutor.executePlan(
        tokenData.sessionId,
        tokenData.plan,
      );
      
      // Send confirmation email
      await this.emailService.sendApprovalConfirmation(
        tokenData.sessionId,
        'approved',
      );
      
      // Redirect to success page
      res.redirect(`${this.baseUrl}/approval-success.html`);
    } catch (error) {
      res.redirect(`${this.baseUrl}/approval-error.html?error=${error.message}`);
    }
  }
  
  @Get('reject/:token')
  async handleRejection(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      const tokenData = await this.tokenService.validateAndConsumeToken(token);
      
      // Mark plan as rejected
      await this.sessionService.updateSession(tokenData.sessionId, {
        planStatus: 'rejected',
        rejectedAt: new Date(),
      });
      
      // Send confirmation
      await this.emailService.sendApprovalConfirmation(
        tokenData.sessionId,
        'rejected',
      );
      
      res.redirect(`${this.baseUrl}/rejection-success.html`);
    } catch (error) {
      res.redirect(`${this.baseUrl}/approval-error.html?error=${error.message}`);
    }
  }
}
```

### 5. Reply-Based Approval Fallback
```typescript
// Handle email replies for approval
class EmailReplyProcessor {
  async processApprovalReply(
    email: ParsedEmail,
    threadContext: ThreadContext,
  ) {
    const content = email.textBody.toLowerCase();
    
    if (content.includes('approve')) {
      // Find pending approval for this thread
      const pendingApproval = await this.getPendingApproval(
        threadContext.threadId,
      );
      
      if (pendingApproval) {
        await this.claudeExecutor.executePlan(
          pendingApproval.sessionId,
          pendingApproval.plan,
        );
        
        await this.emailService.send({
          to: email.from,
          subject: 'Changes Approved and Executed',
          body: 'Your approved changes have been successfully applied.',
        });
      }
    } else if (content.includes('reject')) {
      await this.handleRejection(threadContext);
    }
  }
}
```

### 6. Static Success/Error Pages
```html
<!-- approval-success.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Changes Approved</title>
  <style>
    body {
      font-family: -apple-system, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .message {
      background: white;
      padding: 40px;
      border-radius: 10px;
      text-align: center;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
    }
    .icon { font-size: 48px; }
    h1 { color: #333; }
    p { color: #666; }
  </style>
</head>
<body>
  <div class="message">
    <div class="icon">✅</div>
    <h1>Changes Approved!</h1>
    <p>Your changes are being applied. You'll receive a confirmation email shortly.</p>
    <p><a href="/">Return to site</a></p>
  </div>
</body>
</html>
```

## Implementation Steps

### Phase 1: Approval Detection
1. Implement plan analysis in Claude Code
2. Define approval criteria/thresholds
3. Add approval reason categorization
4. Test detection accuracy

### Phase 2: Email Template System
1. Create HTML email generator
2. Design responsive email layout
3. Implement code diff formatting
4. Test across email clients

### Phase 3: Token Management
1. Set up DynamoDB table for tokens
2. Implement secure token generation
3. Add token validation endpoints
4. Test expiration handling

### Phase 4: Integration
1. Connect to Claude executor
2. Wire up email sending
3. Implement reply processing
4. Add success/error pages

## Security Considerations

### Token Security
- Cryptographically secure random tokens
- SHA-256 hashing for storage
- One-time use enforcement
- 24-hour expiration
- Rate limiting on endpoints

### Email Security
- SPF/DKIM/DMARC configured
- HTML sanitization
- No JavaScript in emails
- Secure redirect URLs

## Testing Plan

### Unit Testing
```bash
# Test token generation
npm test approval-token.service.spec.ts

# Test email generation
npm test approval-email.generator.spec.ts
```

### Integration Testing
```bash
# Generate approval request
curl -X POST $API_URL/api/sessions/test/request-approval \
  -d '{"instruction": "Delete all blog posts"}'

# Simulate approval click
curl $API_URL/api/approve/test-token

# Test email reply
echo "approve" | mail -s "Re: Approval Required" approval@system.com
```

## Success Criteria

### Functional Requirements
- [ ] Approval emails sent for risky changes
- [ ] One-click approval/rejection works
- [ ] Reply-based approval works
- [ ] Tokens expire properly
- [ ] Confirmation emails sent

### UX Requirements
- [ ] Clear change presentation
- [ ] Mobile-responsive emails
- [ ] Visual diff display
- [ ] Fast approval process
- [ ] Helpful error messages

### Security Requirements
- [ ] Secure token generation
- [ ] One-time token use
- [ ] Proper expiration
- [ ] Rate limiting active
- [ ] No token replay attacks

## Monitoring

### Metrics
- Approval request rate
- Approval vs rejection ratio
- Time to approval
- Token expiration rate
- Email delivery success

### Alerts
- High rejection rate
- Expired token usage attempts
- Email delivery failures
- Slow approval response times

## Dependencies
- Task 09 (approval detection in Claude)
- Email sending infrastructure (SES)
- DynamoDB for token storage
- Static file hosting for success pages

## Estimated Timeline
- Approval Detection: 3 hours
- Email Templates: 4 hours
- Token System: 3 hours
- Integration: 2 hours
- **Total: 1.5 days**

## Future Enhancements
- Slack/Discord approval integration
- Partial approval (select specific changes)
- Approval delegation to team members
- Change history and audit logs
- Progressive disclosure for complex changes

## Notes
- Consider A/B testing email designs
- Monitor email client compatibility
- Plan for non-HTML email fallback
- Document approval criteria clearly