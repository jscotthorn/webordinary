# Claude Code Container with S3 Architecture

This is the Claude Code container that processes SQS messages, builds Astro sites, and deploys directly to S3 (Sprint 6/7 architecture).

## Architecture

The container uses NestJS with `@ssut/nestjs-sqs` for message handling and deploys to S3:

- **SQS Message Processing**: Receives instructions via SQS queues
- **S3 Static Hosting**: Builds and deploys sites directly to S3 buckets
- **No Web Server**: Container no longer serves web traffic (removed port 8080)
- **Git Branch Management**: Automatically switches branches based on chat thread ID
- **Automatic S3 Sync**: Deploys to S3 after each build

## Environment Variables

Create a `.env.local` file (see `.env.local` example in repo):

```bash
# AWS Configuration
AWS_PROFILE=personal
AWS_REGION=us-west-2
AWS_ACCOUNT_ID=942734823970

# S3 Configuration
CLIENT_ID=amelia
S3_BUCKET_NAME=edit.amelia.webordinary.com

# SQS Configuration (optional for local testing)
INPUT_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-queue
OUTPUT_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-dlq

# Container configuration
WORKSPACE_PATH=/workspace/amelia-astro
DEFAULT_CLIENT_ID=amelia
DEFAULT_USER_ID=scott

# GitHub Configuration
GITHUB_TOKEN=your-github-personal-access-token

# Claude Configuration
ANTHROPIC_API_KEY=your-anthropic-api-key  # Or 'simulation-key' for testing
```

## Message Schema

### Input Message (from Hermes)
```typescript
{
  sessionId: string;        // Chat thread ID
  commandId: string;        // Unique command identifier
  timestamp: number;
  type: 'edit' | 'build' | 'commit' | 'push' | 'preview';
  instruction: string;
  userEmail: string;
  chatThreadId: string;     // For git branch switching
  context: {
    branch: string;         // Current git branch
    lastCommit?: string;
    filesModified?: string[];
  };
}
```

### Output Message (to Hermes)
```typescript
{
  sessionId: string;
  commandId: string;
  timestamp: number;
  success: boolean;
  summary: string;
  filesChanged?: string[];
  error?: string;
  previewUrl?: string;
  interrupted?: boolean;    // True if interrupted by new message
}
```

## Building and Deployment

### Build Docker Image
```bash
# IMPORTANT: Always build for linux/amd64 for AWS ECS
docker build --platform linux/amd64 -t webordinary/claude-code-s3:latest .

# Or use the build script
./build.sh  # Builds with correct architecture
```

### Test Locally
```bash
# Run container test
npm test local-container

# Or run directly with Docker
docker run -it \
  --platform linux/amd64 \
  -e GITHUB_TOKEN="$GITHUB_TOKEN" \
  -e AWS_PROFILE=personal \
  -e CLIENT_ID=amelia \
  -v ~/.aws:/home/appuser/.aws:ro \
  webordinary/claude-code-s3:latest
```

### Deploy to ECS/Fargate
```bash
# Tag for ECR
docker tag webordinary/claude-code-s3:latest \
  942734823970.dkr.ecr.us-west-2.amazonaws.com/webordinary/claude-code-astro:latest

# Push to ECR
AWS_PROFILE=personal aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin 942734823970.dkr.ecr.us-west-2.amazonaws.com

docker push 942734823970.dkr.ecr.us-west-2.amazonaws.com/webordinary/claude-code-astro:latest

# Force ECS deployment
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --force-new-deployment
```

## Testing

### Run Tests
Tests automatically load environment variables from `.env.local`:

```bash
# Run all tests (uses .env.local automatically)
npm test all

# Run specific test suites
npm test container      # Container integration test
npm test integration    # Integration tests
npm test e2e           # End-to-end tests
npm test scripts       # Script tests

# Or with AWS profile shortcuts
npm run test:aws:all      # All tests with AWS profile
npm run test:aws:container # Container test with AWS profile
```

### Test Results
All tests are updated for S3 architecture:
- ✅ S3 deployment verification
- ✅ CloudWatch logs for container health
- ✅ No ALB routing tests (replaced with S3 tests)
- ✅ Git operations and branch management

## Development

### Install Dependencies
```bash
npm install
```

### Build TypeScript
```bash
npm run build
```

### Run Locally (without Docker)
```bash
# Load .env.local and run
npm start

# Run in development mode
npm run dev
```

## Key Features

### S3 Deployment
- **Automatic Build & Deploy**: Processes message → builds Astro → syncs to S3
- **Direct S3 Hosting**: Sites served from `edit.{client}.webordinary.com`
- **No Container Web Server**: Removed port 8080, containers only process and deploy
- **Instant Updates**: S3 sync provides immediate site updates

### Git Integration
- **Branch per Session**: Each chat thread gets branch `thread-{chatThreadId}`
- **Auto-commits**: Before switching sessions or on interrupts
- **Push to Remote**: Commits are pushed to GitHub after changes
- **Improved Commit Messages**: Includes instruction context

### Session Management
- **Multi-Session Support**: Handle multiple chat sessions in one container
- **Session Persistence**: Work preserved across session switches
- **Automatic Branch Switching**: Based on chat thread ID
- **Conflict Resolution**: Handles merge conflicts gracefully

### Error Handling
- **SQS Retry Logic**: Failed messages retry up to 3 times
- **Dead Letter Queue**: After failures, messages go to DLQ
- **CloudWatch Logging**: All operations logged for monitoring
- **Graceful Recovery**: Container continues after errors

## Architecture Changes (Sprint 6/7)

### What Changed
1. **No Web Server**: Removed Express server (port 8080) - containers don't serve web traffic
2. **S3 Static Hosting**: Sites deployed directly to S3 buckets
3. **CloudWatch Health Checks**: Container health via logs, not HTTP endpoints
4. **Build & Sync**: Astro build followed by S3 sync after each message
5. **No ALB Routing**: ALB no longer routes to containers for web traffic

### Old vs New Architecture
```
Old: User → ALB → Container:8080 → Astro Dev Server
New: User → S3 Website
     SQS → Container → Build → S3 Sync
```

## Monitoring

### CloudWatch Logs
The container logs to CloudWatch with structured logging:
- Message receipt and processing
- Git operations
- Interrupt events
- Error details

### SQS Metrics
Monitor via CloudWatch:
- Messages sent/received
- Message age
- DLQ messages
- Processing time

## Troubleshooting

### Docker Build Issues
```bash
# Always use platform flag for ECS
docker build --platform linux/amd64 -t image-name .

# Common errors:
# "exec format error" = wrong architecture (missing --platform)
# "GITHUB_TOKEN not set" = need to pass token as env var
```

### S3 Deployment Issues
- **No S3 Updates**: Check AWS credentials and S3 permissions
- **Bucket Not Found**: Verify bucket name matches `edit.{client}.webordinary.com`
- **Access Denied**: Check IAM role has S3 write permissions
- **Sync Failures**: Review CloudWatch logs for AWS CLI errors

### Test Failures
```bash
# If tests fail with AWS credentials:
export AWS_PROFILE=personal
npm test all

# If tests fail with "read-only filesystem":
# Tests use /tmp for workspace, not production paths
```

### Container Issues
- **SQS Not Receiving**: Check INPUT_QUEUE_URL and IAM permissions
- **GitHub Token Invalid**: Update token in .env.local
- **Build Failures**: Check Astro project structure in workspace
- **Git Conflicts**: Container handles conflicts, check logs for details

### Common Commands
```bash
# View container logs
AWS_PROFILE=personal aws logs tail /ecs/webordinary/edit --since 10m

# Check S3 bucket
AWS_PROFILE=personal aws s3 ls s3://edit.amelia.webordinary.com/

# Monitor SQS queue
AWS_PROFILE=personal aws sqs get-queue-attributes \
  --queue-url https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-queue \
  --attribute-names All
```