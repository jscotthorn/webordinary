# Architecture Analysis: Simplified S3 Static Hosting Architecture

## Executive Summary

After analyzing the requirements and existing infrastructure, I recommend a **Simplified S3 Static Architecture** that removes all web serving complexity from containers. Containers focus solely on running Claude Code and building Astro sites, then sync the output to S3. The edit domains point directly to S3/CloudFront, eliminating ALB routing, Lambda proxies, and container port management entirely.

## Current Architecture Problems

### 1. **Unnecessary Complexity**
- Containers running web servers just to serve static files
- ALB routing rules for session mapping
- Lambda proxy for request routing
- Health checks and port management overhead

### 2. **Infrastructure Coupling**
- Container lifecycle tied to web serving needs
- Complex networking for container-to-ALB communication
- Session routing through multiple layers

### 3. **Operational Overhead**
- Managing container ports and IPs
- ALB target group updates
- Lambda routing logic maintenance
- Container health monitoring for web serving

## Critical Requirements Analysis

### Must-Have Features
1. **Claude Code Execution**: Containers run Claude to edit code
2. **Astro Build**: Build the site after code changes
3. **S3 Sync**: Deploy built files to S3 bucket
4. **Session Isolation**: Git branches for different sessions
5. **Interrupt Handling**: Stop current work when new message arrives

### What We Can Remove
- **Web Server**: No need for Express/port 8080
- **ALB Routing**: S3/CloudFront handles all web traffic
- **Lambda Proxy**: Direct S3 access via CloudFront
- **Health Checks**: Containers don't serve HTTP
- **Port Management**: No network exposure needed

## Proposed Simplified S3 Architecture

### Core Concept: Containers Build and Deploy to S3
```
Container Pool (Headless - No Web Serving)
├── Container 1: amelia-project1 (runs Claude, builds Astro, syncs to S3)
├── Container 2: bob-website (runs Claude, builds Astro, syncs to S3)
└── Scales to 0 when idle

S3 Static Hosting Structure
├── edit.amelia.webordinary.com/  (bucket name matches URL)
│   ├── index.html
│   ├── _astro/
│   └── [built files]
├── amelia.webordinary.com/  (existing prod bucket)
│   └── [production site files]
├── edit.bob.webordinary.com/
│   ├── index.html
│   ├── _astro/
│   └── [built files]

Direct S3 Hosting (Non-Prod/PoC)
├── edit.amelia.webordinary.com → S3 bucket website endpoint
├── No CloudFront for instant updates (no invalidation delays)
└── Optional: CloudFront with caching fully disabled for monitoring

Container Workflow
1. Receive message via SQS
2. Switch to session git branch (or create new)
3. Run Claude Code to edit files
4. Commit changes to git branch
5. Run 'npm run build' (Astro)
6. Sync dist/ to S3 bucket
7. Push git commits to upstream
8. Site immediately live at edit domain
```

### Key Improvements

#### 1. **Dramatic Simplification**
- No web server in containers
- No ALB routing complexity
- No Lambda proxy layer
- No port management
- No health checks for HTTP

#### 2. **Clean Separation of Concerns**
- Containers: Run Claude + Build Astro
- S3: Serve static content
- CloudFront: CDN and HTTPS
- Route53: DNS management

#### 3. **Instant Updates**
- Build completes → S3 sync → Live immediately
- No container restart needed
- No target group updates
- No routing changes

#### 4. **Cost and Performance Benefits**
- S3 hosting is extremely cheap
- CloudFront provides global CDN
- No container resources wasted on web serving
- Containers can focus on compute tasks

## Implementation Strategy

### Phase 0: Manual PoC Setup (Immediate)
1. **Create S3 Bucket for PoC**
   ```bash
   # Manual setup via AWS Console
   Bucket name: edit.amelia.webordinary.com  # Must match URL exactly
   Region: us-west-2
   Static website hosting: Enabled
   Index document: index.html
   Error document: 404.html
   Bucket policy: Allow public read
   
   # Note: amelia.webordinary.com already exists for production
   ```

2. **Configure Route53**
   ```bash
   # Point edit.amelia.webordinary.com to S3
   Type: A record (Alias)
   Target: S3 website endpoint
   # Example: edit-amelia-webordinary.s3-website-us-west-2.amazonaws.com
   ```

3. **Test Local S3 Sync**
   ```bash
   # Build Astro locally
   npm run build
   
   # Test sync to S3
   aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete
   
   # Verify at edit.amelia.webordinary.com
   ```

### Phase 1: Remove Web Server Components (1 day)
1. **Strip Container to Essentials**
   ```dockerfile
   # Simplified Dockerfile
   FROM node:20-alpine
   
   # Install Claude Code CLI
   RUN npm install -g @anthropic/claude-code
   
   # Install AWS CLI for S3 sync
   RUN apk add --no-cache aws-cli
   
   WORKDIR /workspace
   
   # Simple entrypoint - just process messages
   CMD ["node", "message-processor.js"]
   ```

2. **Container Message Handler with Git Workflow**
   ```typescript
   async handleMessage(message: SQSMessage) {
     const { sessionId, clientId, projectId, command, threadId } = message;
     
     // 1. Switch to session branch (handle interrupts)
     const branchName = `thread-${threadId}`;
     if (this.currentBranch !== branchName) {
       // Commit any pending changes from previous session
       if (await this.gitService.hasChanges()) {
         await this.gitService.commit('Session interrupted - saving work');
         await this.gitService.push();
       }
       
       // Switch to or create session branch
       await this.gitService.checkoutBranch(branchName);
       this.currentBranch = branchName;
     }
     
     // 2. Run Claude CLI with JSON output
     const claudeResult = await exec(
       `claude -p "${command}" --output-format json`,
       { capture: true }
     );
     const result = JSON.parse(claudeResult.stdout);
     
     // 3. Commit changes
     if (await this.gitService.hasChanges()) {
       await this.gitService.commit(`Claude: ${command}`);
     }
     
     // 4. Build Astro site
     await exec('npm run build');
     
     // 5. Sync to S3 (no CloudFront invalidation for non-prod)
     const bucket = `edit.${clientId}.webordinary.com`;
     await exec(`aws s3 sync ./dist s3://${bucket} --delete`);
     
     // 6. Push commits to upstream
     await this.gitService.push();
   }
   ```

### Phase 2: S3 Configuration for Non-Prod (Manual)

1. **S3 Bucket for Direct Website Hosting**
   ```bash
   # S3 bucket with public website hosting
   Bucket naming: edit.{clientId}.webordinary.com  # Matches URL exactly
   Static website hosting: Enabled
   Public access: Allowed (for website hosting)
   CORS: Configured for Astro assets
   
   # Bucket policy for public read
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Sid": "PublicReadGetObject",
       "Effect": "Allow",
       "Principal": "*",
       "Action": "s3:GetObject",
       "Resource": "arn:aws:s3:::edit.${clientId}.webordinary.com/*"
     }]
   }
   ```

2. **Optional: CloudFront with Disabled Caching**
   ```typescript
   // Only if monitoring/logging needed
   const distribution = new cloudfront.Distribution(this, 'EditDistribution', {
     defaultBehavior: {
       origin: new origins.S3Origin(bucket),
       cachePolicy: CachePolicy.CACHING_DISABLED,  // No caching for dev
       // OR custom cache policy with TTL = 0
     },
     // Skip for PoC - adds complexity without benefit
   });
   ```

### Phase 3: Simplified Container Workflow (2 days)

1. **Complete Message Processing with Git Flow**
   ```typescript
   class MessageProcessor {
     private s3Client = new S3Client({ region: 'us-west-2' });
     private bucketName: string;
     private currentBranch: string | null = null;
     
     async handleMessage(message: SQSMessage) {
       const { sessionId, clientId, projectId, command, threadId } = message;
       
       // Setup bucket name
       this.bucketName = `edit.${clientId}.webordinary.com`;
       const branchName = `thread-${threadId}`;
       
       // 1. Handle session switching (interrupts)
       if (this.currentBranch && this.currentBranch !== branchName) {
         // Save work from interrupted session
         if (await this.gitService.hasChanges()) {
           await this.gitService.addAll();
           await this.gitService.commit('Interrupted - saving work');
           await this.gitService.push();
         }
       }
       
       // 2. Switch to or create session branch
       await this.gitService.checkoutBranch(branchName);
       this.currentBranch = branchName;
       
       // 3. Run Claude CLI with JSON output
       const claudeCmd = `claude -p "${command}" --output-format json`;
       const claudeOutput = await exec(claudeCmd, { capture: true });
       const claudeResult = JSON.parse(claudeOutput.stdout);
       
       // 4. Commit Claude's changes
       if (await this.gitService.hasChanges()) {
         await this.gitService.addAll();
         await this.gitService.commit(`Claude: ${command.substring(0, 50)}...`);
       }
       
       // 5. Build and deploy if needed
       if (claudeResult.filesChanged) {
         await this.buildAstro();
         await this.syncToS3();
       }
       
       // 6. Push all commits to upstream
       await this.gitService.push();
     }
     
     async buildAstro() {
       await exec('npm run build', { cwd: this.workspacePath });
     }
     
     async syncToS3() {
       // Simple sync for non-prod (no cache headers needed)
       const command = `aws s3 sync ./dist s3://${this.bucketName} --delete`;
       await exec(command, { cwd: this.workspacePath });
     }
   }
   ```

2. **IAM Permissions for Container**
   ```typescript
   // Container task role needs S3 permissions
   const taskRole = new iam.Role(this, 'ContainerTaskRole', {
     assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
     inlinePolicies: {
       S3Access: new iam.PolicyDocument({
         statements: [
           new iam.PolicyStatement({
             actions: ['s3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
             resources: [
               'arn:aws:s3:::edit-*-webordinary/*',
               'arn:aws:s3:::edit-*-webordinary'
             ]
           })
         ]
       })
     }
   });
   ```


### Phase 4: Local Container Testing

1. **Run Container Locally (like we did with Hermes)**
   ```bash
   # In claude-code-container directory
   cd /Users/scott/Projects/webordinary/claude-code-container
   
   # Build container locally
   docker build -t claude-container-local .
   
   # Run with local environment
   docker run -it \
     -v /workspace:/workspace \
     -e AWS_PROFILE=personal \
     -e CLIENT_ID=amelia \
     -e PROJECT_ID=stamps \
     -e WORKSPACE_PATH=/workspace/amelia/stamps \
     -e INPUT_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/... \
     claude-container-local
   ```

2. **Test Message Processing Flow**
   ```typescript
   // Send test message to local container via SQS
   const testMessage = {
     sessionId: 'test-session-123',
     threadId: 'test-thread-456',
     clientId: 'amelia',
     projectId: 'stamps',
     command: 'Update the homepage title to "Amelia Stamps - Handcrafted with Love"'
   };
   
   // Container should:
   // 1. Switch to thread-test-thread-456 branch
   // 2. Run: claude -p "Update the homepage..." --output-format json
   // 3. Commit changes
   // 4. Run: npm run build
   // 5. Sync: aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete
   // 6. Push to git
   ```

3. **Verify Results**
   ```bash
   # Check git branch was created/updated
   git branch -r | grep thread-test-thread-456
   
   # Verify S3 sync worked
   aws s3 ls s3://edit.amelia.webordinary.com/
   
   # Test site is live
   curl https://edit.amelia.webordinary.com
   ```

## Security Benefits of S3 Architecture

### Improved Security Posture
1. **S3 Bucket Isolation**
   - Each client gets dedicated S3 bucket
   - IAM policies restrict container access to specific buckets
   - No cross-client access possible at infrastructure level

2. **Simplified Attack Surface**
   - No web server vulnerabilities
   - No open ports on containers
   - No ALB routing exploits
   - Static files only in S3

3. **CloudFront Security**
   - DDoS protection built-in
   - WAF integration available
   - Geo-restriction if needed
   - HTTPS enforcement

4. **Container Security**
   - Containers never exposed to internet
   - Only outbound S3 API calls
   - No inbound traffic handling
   - Reduced attack vectors

## Cost Analysis

### Previous Architecture (Container Web Serving)
- **ALB**: ~$20/month base + data transfer
- **Container compute**: $0.10/hour when running
- **Complex networking**: NAT gateway, etc.

### New S3 Architecture (Non-Prod)
- **S3 Storage**: ~$0.50/month per site (10GB estimate)
- **CloudFront**: $0 (not using for non-prod to avoid invalidation delays)
- **Container compute**: Same, but shorter run times
- **Total savings**: ~$20-25/month in infrastructure

## Realistic Migration Timeline

### Sprint 1: Foundation (Week 1-2)
**Goal: Get S3 hosting working manually**
- Day 1-2: Manual S3 bucket setup (edit.amelia.webordinary.com)
- Day 3: Route53 configuration and testing
- Day 4-5: Local testing of S3 sync from dev machine
- Day 6-7: Document process and verify bucket policies
- Day 8-10: Test with actual Astro builds

### Sprint 2: Container Refactoring (Week 3-4)
**Goal: Remove web server, add S3 sync**
- Day 1-3: Remove Express/WebServerService from container
- Day 4-5: Remove port 8080, health checks, networking
- Day 6-7: Add Claude CLI with JSON output
- Day 8-9: Add S3 sync functionality with IAM permissions
- Day 10-12: Local container testing with docker

### Sprint 3: Git Integration (Week 5-6)
**Goal: Proper git workflow with branches**
- Day 1-3: Implement session branch switching
- Day 4-5: Add interrupt handling with commits
- Day 6-7: Test multi-session scenarios
- Day 8-9: Push to upstream after builds
- Day 10-12: Integration testing with SQS messages

### Sprint 4: End-to-End Testing (Week 7-8)
**Goal: Full workflow from email to live site**
- Day 1-3: Deploy updated container to ECS
- Day 4-5: Test Hermes → Container → S3 flow
- Day 6-7: Debug and fix issues
- Day 8-9: Performance testing and optimization
- Day 10: Documentation and handoff

### Sprint 5: Cleanup (Week 9)
**Goal: Remove old infrastructure**
- Day 1-2: Remove ALB listener rules
- Day 3: Decommission Lambda router
- Day 4: Update monitoring/alerts
- Day 5: Final testing and verification

## Scope of Changes

### Infrastructure to Remove
1. **ALB Components**
   - Listener rules for edit domains
   - Target groups for containers
   - Health check configurations

2. **Lambda Router**
   - Entire function can be removed
   - No more session routing logic

3. **Container Networking**
   - Security group ingress rules
   - Container port mappings
   - Service discovery entries

### Infrastructure to Add
1. **S3 Buckets**
   - One per client for static hosting
   - Versioning enabled for rollback
   - Lifecycle policies for old builds

2. **CloudFront Distributions**
   - One per client domain
   - Origin pointing to S3
   - Custom error pages

3. **IAM Policies**
   - Container role with S3 write access
   - Bucket policies for CloudFront

### Container Changes
1. **Remove**
   - Express server code
   - Port 8080 configuration
   - Health check endpoint
   - WebServerService

2. **Add**
   - S3 sync after build
   - CloudFront invalidation (optional)
   - Build status reporting

3. **Keep**
   - SQS message handling
   - Claude Code execution
   - Git branch management
   - Astro build process

## Key Benefits of S3 Architecture

### Operational Simplicity
1. **No Container Web Serving**
   - Containers focus on compute only
   - No port management
   - No health checks
   - No networking complexity

2. **Direct Static Hosting (Non-Prod)**
   - S3 handles all web traffic directly
   - No CloudFront = no invalidation delays
   - No proxy layers
   - Instant updates after S3 sync completes

3. **Reduced Failure Points**
   - No ALB routing failures
   - No Lambda cold starts
   - No container port issues
   - Static files always available

### Developer Experience
1. **Faster Iterations**
   - Build → Deploy → Live immediately
   - No container restarts
   - No routing updates
   - Clear separation of concerns

2. **Better Debugging**
   - S3 versioning shows all deployments
   - CloudFront logs show access patterns
   - Container logs focus on builds only
   - Simplified troubleshooting

3. **Cost Transparency**
   - S3 costs predictable
   - CloudFront costs minimal
   - Container time reduced
   - No ALB hourly charges

## Implementation Complexity Assessment

### High Complexity Items (Underestimated)
1. **Claude CLI Integration**
   - Need to install Claude CLI in container
   - Handle JSON parsing and error cases
   - Manage API keys/authentication

2. **Git Workflow**
   - Branch switching with uncommitted changes
   - Interrupt handling across sessions
   - Merge conflicts resolution
   - Push authentication to GitHub

3. **S3 Sync Permissions**
   - IAM role updates for containers
   - Bucket policies for public access
   - CORS configuration for Astro assets

### Medium Complexity Items
1. **Container Refactoring**
   - Remove web server cleanly
   - Update health check strategy
   - Modify SQS message handling

2. **Local Testing Setup**
   - Docker environment variables
   - AWS credentials in container
   - EFS volume mounting locally

### Low Complexity Items
1. **S3 Bucket Creation** - Manual, straightforward
2. **Route53 Setup** - Simple A record
3. **Remove ALB Rules** - Just deletion

## Conclusion

The Simplified S3 Static Architecture provides massive benefits:

### What We Eliminate
- **Web server complexity** - No Express, no ports, no health checks
- **ALB routing overhead** - No listener rules, no target groups
- **Lambda proxy layer** - No cold starts, no routing logic
- **Network management** - No container IPs, no service discovery

### What We Gain
- **Simplicity** - Containers just build and deploy
- **Reliability** - Static files always available via S3
- **Performance** - CloudFront CDN globally distributed
- **Cost savings** - ~$20-30/month reduction in infrastructure
- **Security** - Reduced attack surface, no open ports

### Why This Works for Non-Prod/PoC
- **Astro builds static sites** - Perfect for S3 hosting
- **No CloudFront delays** - Instant updates for development
- **Git workflow preserved** - Branches, commits, and pushes still work
- **Manual setup is fine** - PoC doesn't need automation yet
- **Containers focus on compute** - Claude + build + deploy only

### Immediate Next Steps for PoC
1. **Manual S3 bucket creation** - edit.amelia.webordinary.com (matches URL)
2. **Route53 A record** - Point to S3 website endpoint  
3. **Test local S3 sync** - Verify from dev machine first
4. **Begin container refactoring** - Start with removing web server
5. **Install Claude CLI** - Test JSON output format locally

### Critical Path Items
- **Week 1**: Get S3 hosting working manually (foundation)
- **Week 2-3**: Container refactoring without git complexity
- **Week 4-5**: Add git workflow and branch management
- **Week 6-7**: Full integration testing
- **Week 8-9**: Production deployment and cleanup

This architecture removes unnecessary complexity while maintaining all essential functionality including git workflows. The edit domains will show the latest build immediately after S3 sync (no CloudFront invalidation delays), containers can focus on running Claude and building sites, and the infrastructure becomes dramatically simpler to maintain and debug.