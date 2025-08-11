# WebOrdinary

An AI Agent-based CMS SaaS platform that enables users to manage websites through natural language instructions. Built on Astro for static site generation with S3 hosting, and Claude Code running in Fargate containers for intelligent content management.

## 🏗️ Current Architecture (Sprint 6/7 - S3 Static Hosting)

### Production Flow
```
User Instructions (Email/SMS/Chat)
    ↓
Hermes Service (Message Orchestration)
    ↓ SQS
Container (Claude Code + Astro)
    ↓ Build & Deploy
S3 Static Hosting (edit.{client}.webordinary.com)
    ↓
CloudFront CDN → Production Site
```

### Key Architecture Changes
- **S3 Static Hosting**: All sites served from S3, not containers
- **No Container Web Server**: Removed port 8080, containers only process and deploy
- **CloudWatch Health Monitoring**: No HTTP health checks, uses logs instead
- **Build → S3 Sync**: Every message triggers Astro build and S3 deployment

## 🚀 Live Production

### Amelia Stamps (First Client)
- **Production**: https://amelia.webordinary.com (CloudFront → S3)
- **Editor S3**: https://edit.amelia.webordinary.com (S3 static site)
- **GitHub**: ameliastamps/amelia-astro
- **Auto-Deploy**: GitHub webhook → Lambda → S3 → CloudFront

## 📦 Core Components

### 1. Claude Code Container (`/claude-code-container/`)
- Processes SQS messages from Hermes
- Builds Astro sites and deploys to S3
- Manages Git branches per chat session
- No web server - pure message processor
- **[README](claude-code-container/README.md)** | **[CLAUDE.md](claude-code-container/CLAUDE.md)**

### 2. Hermes Service (`/hermes/`)
- Message orchestration and routing
- Container lifecycle management
- Session state in DynamoDB
- Queue management per user+project
- **[README](hermes/README.md)** | **[CLAUDE.md](hermes/CLAUDE.md)**

### 3. Infrastructure (`/hephaestus/`)
- AWS CDK infrastructure as code
- ECS/Fargate, S3, CloudFront, Route53
- DynamoDB tables, SQS queues
- Lambda functions for builds
- **[README](hephaestus/README.md)**

## 🧪 Testing

### Test Locations and Commands

#### Claude Code Container Tests (`/claude-code-container/tests/`)
```bash
npm test all              # All tests
npm test container        # Container integration
npm test scripts          # Script tests
```
- JavaScript-based tests
- S3 deployment verification
- Git operations testing

#### Hermes Tests (`/hermes/test/`)
```bash
AWS_PROFILE=personal npm run test:integration  # Integration tests
AWS_PROFILE=personal npm run test:e2e         # End-to-end tests
```
- NestJS/TypeScript tests
- SQS message processing
- DynamoDB operations

#### Integration Tests (`/tests/integration/`)
```bash
AWS_PROFILE=personal npm run test:infrastructure  # Infrastructure validation
AWS_PROFILE=personal npm run test:s3             # S3 deployment tests
AWS_PROFILE=personal npm run test:all            # All scenarios
```
- TypeScript integration tests
- End-to-end S3 deployment verification
- CloudWatch log monitoring

### Test Documentation
- **[Integration Test README](tests/integration/README.md)**
- **[S3 Test Documentation](claude-code-container/README-S3-TESTS.md)**
- **[Session Resumption Testing](tests/integration/SESSION_RESUMPTION_TESTING.md)**

## 🚀 Quick Start

### Prerequisites
- AWS CLI configured with `personal` profile
- Node.js 20+
- Docker Desktop
- GitHub Personal Access Token

### Deploy Infrastructure
```bash
cd hephaestus
npm install
npm run build
npx cdk deploy --all --profile personal
```

### Build and Deploy Container
```bash
cd claude-code-container
docker build --platform linux/amd64 -t webordinary/claude-code-astro .
./build.sh  # Builds and pushes to ECR
```

### Scale Services
```bash
# Start Hermes
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-hermes-service \
  --desired-count 1

# Start Edit Container (auto-scales with messages)
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --desired-count 1
```

## 📊 Message Flow

### Input Message Schema
```typescript
{
  sessionId: string;
  type: 'edit' | 'build' | 'commit' | 'push';
  instruction: string;
  chatThreadId: string;  // Git branch: thread-{chatThreadId}
  userEmail: string;
}
```

### Processing Flow
1. **Message Receipt**: SQS → Container
2. **Git Branch**: Switch to `thread-{chatThreadId}`
3. **Claude Code**: Process instruction
4. **Astro Build**: Generate static site
5. **S3 Sync**: Deploy to bucket
6. **Response**: Send result via output queue

## 💰 Cost Analysis

### Monthly Costs
- **S3 Hosting**: ~$1-5/month
- **CloudFront CDN**: ~$1-5/month
- **ECS/Fargate**: $0 idle, ~$0.10/hour active
- **DynamoDB**: ~$1/month
- **SQS**: <$1/month
- **ALB**: $18-20/month (shared)
- **Route53**: $0.50/month
- **Total Idle**: ~$25-30/month
- **Total Active (10hrs)**: ~$28-35/month

## 🔧 Monitoring

### CloudWatch Logs
```bash
# Container logs
AWS_PROFILE=personal aws logs tail /ecs/webordinary/edit --since 10m

# Hermes logs
AWS_PROFILE=personal aws logs tail /ecs/hermes --since 10m
```

### S3 Deployment Status
```bash
# Check S3 bucket
AWS_PROFILE=personal aws s3 ls s3://edit.amelia.webordinary.com/

# View site
open https://edit.amelia.webordinary.com
```

### SQS Queue Status
```bash
AWS_PROFILE=personal aws sqs get-queue-attributes \
  --queue-url https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-queue \
  --attribute-names ApproximateNumberOfMessages
```

## 📋 Sprint Status

### Completed
- ✅ **Sprint 1**: Core infrastructure (ECR, EFS, ALB, Fargate)
- ✅ **Sprint 3**: Amelia Astro dual deployment
- ✅ **Sprint 4**: Multi-session SQS architecture (85%)
- ✅ **Sprint 6**: S3 static hosting migration
- ✅ **Sprint 7**: Git workflow with S3 deployment
- ✅ **Sprint 8**: Test suite updates for S3 architecture

### Current Focus
- Session resumption optimization
- Multi-client onboarding
- Performance monitoring dashboards

## 🐛 Troubleshooting

### Common Issues
- **Docker build fails**: Always use `--platform linux/amd64`
- **S3 not updating**: Check AWS credentials and bucket permissions
- **Container not starting**: Verify ECR image and ECS task definition
- **Tests failing**: Ensure `AWS_PROFILE=personal` is set

### Important Notes
- Containers don't serve HTTP - only process messages and deploy to S3
- All web traffic serves from S3 buckets
- Use CloudWatch logs for health monitoring, not HTTP endpoints
- Git branches follow pattern: `thread-{chatThreadId}`

## 📚 Documentation

### Key Documents
- **[Task Definitions](tasks/)** - Sprint planning and completion notes
- **[Architecture Decisions](hephaestus/docs/)** - CDK and infrastructure docs
- **[Test Documentation](tests/integration/README.md)** - Integration test guide

### Quick Reference Files
- **[Root CLAUDE.md](CLAUDE.md)** - Quick commands and test locations
- **[Container CLAUDE.md](claude-code-container/CLAUDE.md)** - Container-specific notes
- **[Hermes CLAUDE.md](hermes/CLAUDE.md)** - Service-specific notes

## 🔮 Future Enhancements
- Lambda@Edge for advanced routing
- Multi-region S3 replication
- CloudWatch dashboard automation
- GitHub Actions CI/CD pipeline
- User authentication for editor access