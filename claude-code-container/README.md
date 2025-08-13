# Claude Code Container - S3 Architecture

Message processor for the WebOrdinary platform that transforms user instructions into deployed static sites.

## 🏗️ Current Architecture (Sprint 7+)

```
┌─────────────────────────────────────────────────────────────┐
│                     Message Flow                             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  SQS Unclaimed Queue                                         │
│         ↓                                                     │
│  Container Claims Project+User                               │
│         ↓                                                     │
│  SQS Project+User Input Queue                               │
│         ↓                                                     │
│  Process with Claude Code CLI                               │
│         ↓                                                     │
│  Build Astro Site                                           │
│         ↓                                                     │
│  Deploy to S3 Bucket                                        │
│         ↓                                                     │
│  Commit to Git (branch: thread-{id})                        │
│         ↓                                                     │
│  SQS Output Queue (Response)                                │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 📋 Key Features

- **Project+User Ownership**: Containers claim `project+user` combinations (e.g., `amelia+scott`)
- **Queue-Based Processing**: All communication via SQS, no HTTP servers
- **S3 Deployment**: Direct deployment to `edit.{projectId}.webordinary.com` buckets
- **Git Branch Per Thread**: Automatic branch management (`thread-{chatThreadId}`)
- **CloudWatch Health**: Container health via logs, not HTTP endpoints
- **Dynamic Repository**: Gets repo URL from messages, not environment variables

## 🚀 Quick Start

### Prerequisites
- Docker with `--platform linux/amd64` support
- AWS credentials configured
- GitHub personal access token
- Node.js 18+ (for local development)

### Environment Setup

Create `.env.local`:
```bash
# AWS Configuration
AWS_REGION=us-west-2
AWS_ACCOUNT_ID=942734823970

# Queue URLs (discovered dynamically in production)
UNCLAIMED_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed

# DynamoDB Tables
CONTAINER_OWNERSHIP_TABLE=webordinary-container-ownership
SESSION_TABLE=webordinary-edit-sessions
THREAD_MAPPINGS_TABLE=webordinary-thread-mappings

# S3 Configuration
S3_BUCKET_PATTERN=edit.{projectId}.webordinary.com

# Container Configuration
CONTAINER_ID=local-test-container
WORKSPACE_PATH=/workspace
EFS_MOUNT_PATH=/mnt/efs

# GitHub Configuration
GITHUB_TOKEN=ghp_your_token_here

# Claude Configuration (Bedrock)
CLAUDE_CODE_USE_BEDROCK=1
AWS_BEDROCK_REGION=us-west-2
```

### Build and Run

```bash
# Build container (ALWAYS use platform flag)
docker build --platform linux/amd64 -t webordinary/claude-code:latest .

# Run locally
docker run -it \
  --platform linux/amd64 \
  -e GITHUB_TOKEN="$GITHUB_TOKEN" \
  -e AWS_PROFILE=personal \
  -v ~/.aws:/home/appuser/.aws:ro \
  -v /tmp/workspace:/workspace \
  webordinary/claude-code:latest

# Or use Docker Compose
docker compose -f docker-compose.local.yml up claude-container
```

## 📨 Message Processing

### Input Message Format
```typescript
interface InputMessage {
  // Core Fields
  sessionId: string;        // Session identifier
  threadId: string;         // Email thread ID (for git branch)
  projectId: string;        // Project identifier (e.g., 'amelia')
  userId: string;           // User identifier (e.g., 'scott')
  instruction: string;      // User's instruction
  
  // Repository Information (from message, not env)
  repoUrl?: string;         // Git repository URL
  
  // Optional Context
  commandId?: string;       // Unique command ID
  timestamp?: number;       // Message timestamp
  previousCommit?: string;  // Last commit SHA
}
```

### Output Message Format
```typescript
interface OutputMessage {
  commandId: string;        // Echo from input
  sessionId: string;        // Echo from input
  success: boolean;         // Processing result
  summary: string;          // Human-readable summary
  
  // Deployment Info
  s3Bucket?: string;        // Deployed bucket name
  s3Url?: string;           // Full S3 website URL
  deploymentTime?: number;  // Deployment timestamp
  
  // Git Info
  branch?: string;          // Git branch used
  commitId?: string;        // New commit SHA
  filesChanged?: string[];  // Modified files
  
  // Error Handling
  error?: string;           // Error message if failed
  interrupted?: boolean;    // If interrupted by new message
}
```

## 🔄 Processing Workflow

1. **Monitor Unclaimed Queue**: Wait for work when no active claim
2. **Claim Project+User**: Take ownership of `projectId+userId` combination
3. **Switch Workspace**: Move to `/mnt/efs/{projectId}-{userId}/`
4. **Clone/Pull Repository**: Get repo from message.repoUrl (first time) or pull
5. **Checkout Branch**: Switch to `thread-{threadId}` branch
6. **Process Instruction**: Execute with Claude Code CLI
7. **Build Astro**: Run `npm run build` if changes made
8. **Deploy to S3**: Sync dist/ to `s3://edit.{projectId}.webordinary.com/`
9. **Commit Changes**: Commit with context message
10. **Push to Remote**: Push branch to origin
11. **Send Response**: Return result to output queue

## 🧪 Testing

### Unit Tests
```bash
npm test unit                    # Unit tests only
npm test queue-processing        # Queue processing tests
```

### Integration Tests
```bash
npm test container              # Container integration
npm test s3-deployment          # S3 deployment tests
npm test git-operations         # Git workflow tests
```

### E2E Tests
```bash
npm test e2e                    # Full end-to-end tests
```

### Local Testing
```bash
# Test with local Docker
./tests/scripts/local-container.test.sh

# Test git operations
./tests/scripts/git-ops.test.sh

# Test S3 sync
./tests/scripts/s3-sync.test.sh
```

## 🚢 Deployment

### Build and Push to ECR
```bash
# Build with correct architecture
docker build --platform linux/amd64 -t webordinary/claude-code:latest .

# Tag for ECR
docker tag webordinary/claude-code:latest \
  942734823970.dkr.ecr.us-west-2.amazonaws.com/webordinary/claude-code:latest

# Push to ECR
docker push 942734823970.dkr.ecr.us-west-2.amazonaws.com/webordinary/claude-code:latest

# Or use the script
./build-and-push.sh
```

### Deploy to ECS
```bash
# Update service with new image
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --force-new-deployment

# Scale service
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --desired-count 2
```

## 📊 Monitoring

### CloudWatch Logs
```bash
# View container logs
AWS_PROFILE=personal aws logs tail /ecs/webordinary/edit --since 10m

# Filter for specific session
AWS_PROFILE=personal aws logs tail /ecs/webordinary/edit \
  --filter-pattern "session-123" --since 1h
```

### S3 Deployments
```bash
# Check deployment
AWS_PROFILE=personal aws s3 ls s3://edit.amelia.webordinary.com/

# View recent changes
AWS_PROFILE=personal aws s3 ls s3://edit.amelia.webordinary.com/ \
  --recursive --summarize
```

### Queue Metrics
```bash
# Check unclaimed queue
AWS_PROFILE=personal aws sqs get-queue-attributes \
  --queue-url https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed \
  --attribute-names ApproximateNumberOfMessages

# Check project queue
AWS_PROFILE=personal aws sqs get-queue-attributes \
  --queue-url https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-input-amelia-scott \
  --attribute-names ApproximateNumberOfMessages
```

## 🔧 Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Exec format error | Always build with `--platform linux/amd64` |
| S3 sync fails | Check AWS credentials and bucket permissions |
| Git push fails | Verify GITHUB_TOKEN has write access |
| Container not claiming | Check unclaimed queue and DynamoDB ownership |
| Build fails | Ensure Astro dependencies installed |
| Tests fail | Verify .env.local has all required variables |

### Debug Commands
```bash
# Check container ownership
AWS_PROFILE=personal aws dynamodb get-item \
  --table-name webordinary-container-ownership \
  --key '{"projectKey": {"S": "amelia#scott"}}'

# View thread mappings
AWS_PROFILE=personal aws dynamodb scan \
  --table-name webordinary-thread-mappings \
  --filter-expression "threadId = :tid" \
  --expression-attribute-values '{":tid": {"S": "thread-123"}}'

# Check container health
docker inspect <container-id> | jq '.[0].State.Health'
```

## 🏛️ Architecture Decisions

### Why No HTTP Server?
- Containers are ephemeral processors, not servers
- S3 provides better static hosting (CDN, scaling, cost)
- Removes complexity of ALB routing and health checks
- Allows containers to focus on processing

### Why Project+User Ownership?
- Single container handles all sessions for a user on a project
- Reduces container churn and cold starts
- Maintains workspace continuity
- Efficient resource utilization

### Why Branch Per Thread?
- Isolates work for each email conversation
- Prevents conflicts between concurrent sessions
- Natural git history per conversation
- Easy rollback and review

## 📚 Related Documentation

- [Hermes README](../hermes/README.md) - Message orchestration service
- [Hephaestus README](../hephaestus/README.md) - Infrastructure as code
- [Integration Tests](../tests/integration/README.md) - Test documentation
- [Architecture Overview](../refactor-authority/README.md) - System architecture

## 🔄 Migration from Legacy

### Removed Features
- ❌ Express HTTP server (port 8080)
- ❌ WebSocket support
- ❌ ALB routing to containers
- ❌ Session-per-container pattern
- ❌ Environment variables: CLIENT_ID, REPO_URL, DEFAULT_USER_ID

### New Patterns
- ✅ S3 static site hosting
- ✅ SQS message processing only
- ✅ Project+user claiming
- ✅ Dynamic repository from messages
- ✅ CloudWatch health monitoring

## 📝 License

Proprietary - WebOrdinary 2024

---

For questions or issues, see the [main project documentation](../README.md).