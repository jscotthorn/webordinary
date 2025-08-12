# Sprint 9: Local Development Environment Setup
## Hermes & Claude Container with Real AWS Services

### Executive Summary
**Feasibility**: ✅ **HIGHLY FEASIBLE** - Both containers already have excellent local development support  
**Estimated LoE**: **3-5 days** for full setup including Bedrock integration  
**Risk Level**: **LOW** - Most infrastructure already exists

---

## 🎯 Sprint Objective
Enable local development and debugging of the WebOrdinary platform by running Hermes and Claude Container locally in Docker while connecting to real AWS services (DynamoDB, SQS, S3) and integrating Claude Code with Amazon Bedrock.

---

## 📊 Current State Analysis

### ✅ What's Already Working
1. **Both containers have local development support**:
   - Hermes: `./scripts/start-local.sh` with hot reload
   - Claude Container: `./scripts/start-local.sh` with Docker
   - Both use `.env.local` files with examples provided

2. **AWS authentication is handled**:
   - Profile-based authentication (`AWS_PROFILE=personal`)
   - Credential mounting for containers
   - Automatic validation on startup

3. **Docker infrastructure exists**:
   - Multi-stage Dockerfiles optimized for production
   - Health checks configured
   - Volume mounting for development

### 🔧 What Needs Work
1. **Bedrock Integration for Claude Code**
2. **Docker Compose orchestration for both services**
3. **Local queue configuration for development**
4. **Documentation consolidation**

---

## 📋 Sprint Tasks

### Task 1: Bedrock Integration (1-2 days)
**Priority**: P0 - Critical  
**LoE**: Medium

#### Subtasks:
1. **Configure IAM permissions for Bedrock** (2h)
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": [
         "bedrock:InvokeModel",
         "bedrock:InvokeModelWithResponseStream",
         "bedrock:ListFoundationModels",
         "bedrock:GetFoundationModel"
       ],
       "Resource": "*"
     }]
   }
   ```

2. **Update Claude Container environment** (1h)
   - Add Bedrock configuration to `.env.local`:
   ```bash
   # Bedrock Configuration
   CLAUDE_CODE_USE_BEDROCK=1
   AWS_REGION=us-east-1  # Bedrock requires specific regions
   CLAUDE_CODE_MAX_OUTPUT_TOKENS=4096
   MAX_THINKING_TOKENS=1024
   ```

3. **Create Bedrock initialization script** (2h)
   - Verify Bedrock access
   - Test model invocation
   - Handle region-specific requirements

4. **Update health checks** (1h)
   - Add Bedrock connectivity check
   - Verify model availability

---

### Task 2: Docker Compose Setup (1 day)
**Priority**: P0 - Critical  
**LoE**: Low

#### Create `docker-compose.local.yml`:
```yaml
version: '3.8'

services:
  hermes:
    build:
      context: ./hermes
      target: development
    env_file:
      - ./hermes/.env.local
    volumes:
      - ./hermes:/app
      - ~/.aws:/home/node/.aws:ro
    ports:
      - "3000:3000"
    networks:
      - webordinary-local
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/hermes/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  claude-container:
    build:
      context: ./claude-code-container
      target: production
    env_file:
      - ./claude-code-container/.env.local
    volumes:
      - ./claude-code-container/workspace:/workspace
      - ~/.aws:/home/appuser/.aws:ro
    ports:
      - "8080:8080"
    networks:
      - webordinary-local
    depends_on:
      hermes:
        condition: service_healthy
    environment:
      - CLAUDE_CODE_USE_BEDROCK=1
      - AWS_REGION=us-east-1

networks:
  webordinary-local:
    driver: bridge
```

---

### Task 3: Local Queue Configuration (0.5 day)
**Priority**: P1 - High  
**LoE**: Low

#### Setup Development Queues:
1. **Create local development queues** in AWS:
   ```bash
   # Development queues (prefix with 'local-dev-')
   aws sqs create-queue --queue-name local-dev-email-queue
   aws sqs create-queue --queue-name local-dev-unclaimed
   aws sqs create-queue --queue-name local-dev-input-ameliastamps-scott
   aws sqs create-queue --queue-name local-dev-output-ameliastamps-scott
   ```

2. **Update environment variables**:
   ```bash
   # .env.local additions
   QUEUE_PREFIX=local-dev
   EMAIL_QUEUE_NAME=local-dev-email-queue
   UNCLAIMED_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/942734823970/local-dev-unclaimed
   ```

---

### Task 4: Local Development Scripts (0.5 day)
**Priority**: P1 - High  
**LoE**: Low

#### Create unified startup script:
```bash
#!/bin/bash
# scripts/start-local-platform.sh

echo "🚀 Starting WebOrdinary Local Development Environment"

# Check AWS credentials
if ! aws sts get-caller-identity --profile personal > /dev/null 2>&1; then
    echo "❌ AWS credentials not configured. Please run 'aws configure --profile personal'"
    exit 1
fi

# Check Bedrock access
if ! aws bedrock list-foundation-models --region us-east-1 --profile personal > /dev/null 2>&1; then
    echo "⚠️  Bedrock access not available. Claude will run in simulation mode."
fi

# Start services
docker-compose -f docker-compose.local.yml up --build
```

---

### Task 5: Documentation & Testing (1 day)
**Priority**: P2 - Medium  
**LoE**: Medium

1. **Create comprehensive local development guide**:
   - Prerequisites checklist
   - Step-by-step setup
   - Troubleshooting guide
   - Common debugging scenarios

2. **Create test scenarios**:
   - End-to-end message flow test
   - Bedrock integration test
   - Queue processing test
   - S3 deployment test

3. **Update existing documentation**:
   - Add Bedrock configuration to CLAUDE.md
   - Update README with local development section
   - Add debugging tips to troubleshooting guide

---

## 🚦 Implementation Plan

### Phase 1: Foundation (Day 1-2)
- [ ] Configure IAM permissions for Bedrock
- [ ] Update environment files with Bedrock config
- [ ] Create docker-compose.local.yml
- [ ] Test basic container startup

### Phase 2: Integration (Day 2-3)
- [ ] Implement Bedrock initialization in Claude Container
- [ ] Create development queues in AWS
- [ ] Test queue-based communication locally
- [ ] Verify S3 deployment from local container

### Phase 3: Polish (Day 3-4)
- [ ] Create unified startup scripts
- [ ] Write comprehensive documentation
- [ ] Create debugging utilities
- [ ] Test complete flow end-to-end

### Phase 4: Validation (Day 4-5)
- [ ] Run full test suite locally
- [ ] Document any limitations
- [ ] Create troubleshooting guide
- [ ] Record demo video

---

## ⚠️ Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Bedrock region limitations | Medium | Use us-east-1 or us-west-2 exclusively |
| AWS credential expiration | Low | Implement refresh mechanism in startup scripts |
| Container networking issues | Low | Use docker-compose for consistent networking |
| Cost of dev AWS resources | Low | Use lifecycle policies, auto-cleanup scripts |

---

## 💰 Cost Considerations

### Estimated Monthly Costs for Local Development:
- **SQS Queues**: ~$2 (minimal traffic)
- **DynamoDB**: ~$5 (on-demand pricing)
- **S3**: ~$1 (development bucket)
- **Bedrock**: ~$10-50 (depending on usage)
- **Total**: ~$20-60/month per developer

### Cost Optimization:
- Use LocalStack for non-critical services
- Implement auto-shutdown for unused resources
- Share development queues among team
- Use Bedrock caching where possible

---

## 📈 Success Metrics

1. **Development Velocity**: 50% faster debugging cycles
2. **Issue Resolution**: Reproduce production issues locally
3. **Onboarding Time**: New developers productive in <1 day
4. **Test Coverage**: Run integration tests locally
5. **Cost Efficiency**: <$50/month per developer

---

## 🎉 Deliverables

1. **Working local development environment** with:
   - Both containers running locally
   - Real AWS service connectivity
   - Bedrock integration for Claude Code

2. **Documentation package**:
   - Setup guide
   - Troubleshooting guide
   - Architecture diagrams
   - Video walkthrough

3. **Automation scripts**:
   - One-command startup
   - Environment validation
   - Resource cleanup

4. **Test suite**:
   - Local integration tests
   - Bedrock connectivity tests
   - End-to-end flow validation

---

## 📝 Notes

### Why This Approach?
1. **Minimal Changes**: Leverages existing local development support
2. **Real AWS Services**: Ensures parity with production
3. **Bedrock Integration**: Enables realistic Claude interactions
4. **Cost Effective**: ~$50/month vs $500+ for full AWS environment

### Alternative Considered:
- **LocalStack**: Would work for SQS/DynamoDB but not Bedrock
- **Full AWS Dev Environment**: Too expensive (~$500/month)
- **Mocked Services**: Insufficient for debugging production issues

### Recommendation:
**Proceed with this approach** - The infrastructure is already 80% ready, and the remaining work is straightforward configuration and documentation. The investment will pay off immediately in improved development velocity and debugging capabilities.

---

## 🔗 Related Documents
- [Sprint 8 Task 2 Summary](../sprint-8/task-02-comprehensive-summary.md)
- [Hermes README](../../hermes/README.md)
- [Claude Container README](../../claude-code-container/README.md)
- [Claude Code Bedrock Docs](https://docs.anthropic.com/en/docs/claude-code/amazon-bedrock)