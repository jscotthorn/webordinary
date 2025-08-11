# Task 05: Add S3 Sync to Container

## Objective
Add functionality to sync Astro build output to S3 after successful builds.

## Context
After removing the web server, the container needs to deploy built files to S3 instead of serving them locally.

## Implementation

### 1. Add AWS SDK for S3
```bash
cd /Users/scott/Projects/webordinary/claude-code-container
npm install @aws-sdk/client-s3
# Or use AWS CLI which is already in the container
```

### 2. Update MessageProcessorService
```typescript
// src/message-processor.service.ts

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

export class MessageProcessorService {
  
  async handleMessage(message: any) {
    const { clientId, projectId, command, threadId } = message.Body;
    
    // 1. Run Claude (existing)
    await this.runClaude(command);
    
    // 2. Build Astro (existing)
    await this.buildAstro();
    
    // 3. NEW: Sync to S3
    await this.syncToS3(clientId);
  }
  
  private async syncToS3(clientId: string) {
    const bucket = `edit.${clientId}.webordinary.com`;
    const distPath = `${this.workspacePath}/dist`;
    
    try {
      // Use AWS CLI for simplicity
      const cmd = `aws s3 sync ${distPath} s3://${bucket} --delete`;
      console.log(`Syncing to S3: ${cmd}`);
      
      const { stdout, stderr } = await execAsync(cmd);
      console.log('S3 sync complete:', stdout);
      
      if (stderr) {
        console.error('S3 sync warnings:', stderr);
      }
    } catch (error) {
      console.error('S3 sync failed:', error);
      throw error;
    }
  }
}
```

### 3. Update Dockerfile for AWS CLI
```dockerfile
FROM node:20-alpine

# Install AWS CLI
RUN apk add --no-cache \
    python3 \
    py3-pip \
    && pip3 install --upgrade pip \
    && pip3 install awscli

# Rest of Dockerfile...
```

### 4. Add IAM Permissions via CDK
Update the ECS task role in the CDK stack:

```typescript
// In hephaestus/lib/fargate-stack.ts (or wherever the task definition is)

// Find the task definition
const taskDefinition = new ecs.FargateTaskDefinition(this, 'EditTaskDef', {
  memoryLimitMiB: 4096,
  cpu: 2048,
  taskRole: taskRole, // <-- Update this role
});

// Add S3 permissions to the task role
taskRole.addToPolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    's3:PutObject',
    's3:DeleteObject', 
    's3:ListBucket',
    's3:GetBucketLocation'
  ],
  resources: [
    'arn:aws:s3:::edit.*.webordinary.com/*',
    'arn:aws:s3:::edit.*.webordinary.com'
  ]
}));

// Deploy the CDK changes
// cd hephaestus
// npm run build
// npx cdk deploy FargateStack
```

### 5. Environment Variables
Container needs AWS region:
```bash
AWS_REGION=us-west-2
# AWS credentials come from ECS task role
```

## Testing

### Local Testing
```bash
# Build container
docker build -t claude-container-s3 .

# Run with AWS credentials
docker run -it \
  -e AWS_PROFILE=personal \
  -e CLIENT_ID=amelia \
  -v ~/.aws:/root/.aws:ro \
  -v /workspace:/workspace \
  claude-container-s3

# Send test message to trigger S3 sync
```

### Verify S3 Sync
```bash
# Check S3 bucket after sync
aws s3 ls s3://edit.amelia.webordinary.com/

# Verify site updated
curl http://edit.amelia.webordinary.com
```

## Acceptance Criteria
- [ ] AWS CLI installed in container
- [ ] S3 sync code added to message processor
- [ ] IAM permissions configured
- [ ] Successful sync to S3 bucket
- [ ] Site updates visible at edit domain

## Error Handling
- Log S3 sync failures clearly
- Don't crash container on sync failure
- Consider retry logic for transient failures

## Time Estimate
2-3 hours

## Notes
- Using AWS CLI is simpler than SDK for sync
- --delete flag ensures old files are removed
- Consider adding progress output for large syncs