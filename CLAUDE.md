# WebOrdinary Quick Reference

## 🚨 CRITICAL: Current Architecture (Sprint 7+)
- **NO WEB SERVERS**: Containers don't serve HTTP (removed port 8080)
- **S3 DEPLOYMENT**: All sites served from S3 buckets
- **CLOUDWATCH HEALTH**: No HTTP health checks, use logs
- **BUILD → S3 SYNC**: Every message triggers Astro build and S3 deployment
- **PROJECT+USER PATTERN**: One container per project+user (NOT per session)

## 📍 Project Structure
```
/webordinary/
├── /claude-code-container/   # Message processor, S3 deployer
│   ├── README.md             # Full documentation
│   ├── CLAUDE.md            # Quick reference
│   └── /tests/              # JavaScript tests
├── /hermes/                 # Message orchestration service
│   ├── README.md           # Full documentation
│   ├── CLAUDE.md          # Quick reference
│   └── /test/             # NestJS tests
├── /hephaestus/           # CDK infrastructure
│   └── README.md         # Infrastructure docs
├── /tests/integration/    # TypeScript integration tests
│   └── README.md        # Test guide
├── /docs/                 # Documentation
│   └── LOCAL_DEVELOPMENT.md  # Local dev guide
└── /tasks/              # Sprint planning & completion notes
```

## 🏠 Local Development (NEW!)

### Quick Start
```bash
# Start local dev environment (Docker Compose)
./scripts/start-local-dev.sh

# Stop local dev
./scripts/stop-local-dev.sh

# Run test suite
./tests/local-dev/test-scenarios.sh
```

### Key Points
- Uses Docker Compose for both Hermes and Claude Container
- Connects to real AWS services (DynamoDB, SQS, S3)
- Bedrock integration optional (simulation mode by default)
- Native architecture for local dev (ARM64 on M1/M2 Macs)
- See `/docs/LOCAL_DEVELOPMENT.md` for complete guide

## 🧪 Test Commands

### Container Tests (`/claude-code-container/`)
```bash
npm test all              # All tests
npm test container        # Container integration
npm test scripts          # Script tests
```

### Hermes Tests (`/hermes/`)
```bash
AWS_PROFILE=personal npm run test:integration
AWS_PROFILE=personal npm run test:e2e
```

### Integration Tests (`/tests/integration/`)
```bash
AWS_PROFILE=personal npm run test:infrastructure
AWS_PROFILE=personal npm run test:s3
AWS_PROFILE=personal npm run test:all
```

## 🔧 Quick Commands

### Build & Deploy
```bash
# Build container (ALWAYS use platform flag)
docker build --platform linux/amd64 -t webordinary/claude-code-astro .

# Deploy infrastructure
cd hephaestus && npx cdk deploy --all --profile personal

# Push container to ECR
./build.sh  # or ./build-and-push.sh
```

### Service Management
```bash
# Scale Hermes
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-hermes-service \
  --desired-count 1  # or 0 to stop

# Scale Edit Container
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --desired-count 1  # or 0 to stop
```

### Monitoring
```bash
# View logs
AWS_PROFILE=personal aws logs tail /ecs/webordinary/edit --since 10m
AWS_PROFILE=personal aws logs tail /ecs/hermes --since 10m

# Check S3 deployment
AWS_PROFILE=personal aws s3 ls s3://edit.amelia.webordinary.com/

# Queue status
AWS_PROFILE=personal aws sqs get-queue-attributes \
  --queue-url https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-queue \
  --attribute-names ApproximateNumberOfMessages
```

## 📝 Key Terminology & Concepts

### Entity Hierarchy
- **Client**: Account holder (future concept, e.g., "Amelia Stamps Inc")
- **Project**: Specific website/application (e.g., "amelia" for the Astro site)
- **User**: Email address working on projects (e.g., escottster@gmail.com)
- **Session**: Email thread mapped to git branch `thread-{chatThreadId}`

### Container Ownership
- **Project+User**: Containers claim "amelia+escottster@gmail.com" combos
- **NOT Session-based**: One container handles all sessions for a project+user
- **Unclaimed Queue**: Available work for warm containers without claims

## 📝 Key Points
1. **Use AWS_PROFILE=personal** for all AWS commands
2. **Always build with `--platform linux/amd64`** for ECS
3. **S3 bucket**: `edit.{projectId}.webordinary.com` pattern
4. **Git branches**: `thread-{chatThreadId}` per email conversation
5. **Scale to 0** when not in use (saves ~$15/month)
6. **Tests need `.env.local`** with AWS credentials
7. **No env vars**: Services use QueueManager.getCurrentClaim() not CLIENT_ID

## 🐛 Common Fixes
- **Exec format error**: Add `--platform linux/amd64` to Docker build
- **S3 not updating**: Check AWS credentials and bucket permissions
- **Tests failing**: Set `AWS_PROFILE=personal`
- **Container not starting**: Check ECR image exists
- **No logs**: Verify CloudWatch log group `/ecs/webordinary/edit`

## 📚 Documentation Priority
1. **Task completion notes**: `/tasks/sprint-*/`
2. **Component READMEs**: See project structure above
3. **Component CLAUDE.md**: Quick reference for each service
4. **Test documentation**: See test commands above

## 💡 Important Notes
- Run tests when modifying code
- Update test cases when features change
- Limit completion notes to: accomplished, remaining, test status, recommendations
- Refer to source documentation for library/service integration
- All web traffic serves from S3, not containers