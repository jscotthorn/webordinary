# WebOrdinary Quick Reference

# ⚠️ MAJOR REFACTOR IN PROGRESS

## Current State (As of 2025-08-17)
- Replacing Hermes with AWS Step Functions
- DO NOT modify Hermes code - it will be deleted
- See REFACTOR_PROPOSAL.md for architecture changes

## During Refactor
- Email flow: SES → S3 → Lambda → Step Functions → Container
- Hermes service will be scaled to 0 but code remains temporarily
- New Lambda functions being added in `/lambda/` directories
- Container message handling being updated for Step Functions callbacks

## Architecture (S3-based, Sprint 7+)
Email → SQS → Hermes → Container → S3 → User

## Key Patterns
- **No HTTP servers** - S3 serves all web content
- **Project+user claiming** - Not session-based
- **Branch per thread** - `thread-{chatThreadId}`
- **Queue-based only** - No direct service communication

## Components
- `/claude-code-container/` - Message processor, S3 deployer
- `/hermes/` - Message router
- `/hephaestus/` - CDK infrastructure
- `/tests/` - Test suites

## Local Development

### Quick Start (Hybrid Mode - RECOMMENDED for Claude SDK work)
Use hybrid mode when developing/testing Claude Code SDK features:
```bash
# 1. Start hybrid (Hermes in Docker, Claude local - uses your subscription!)
./scripts/start-hybrid-dev.sh

# 2. Send test email
./scripts/send-test-email.sh

# 3. Stop when done (or Ctrl+C)
./scripts/stop-hybrid-dev.sh
```

**Why Hybrid?** Uses your Claude subscription, faster iteration, real-time logs, access to macOS Keychain

### Alternative: Full Docker Mode
For production-like testing (uses AWS Bedrock, charges apply):
```bash
# 1. Start services
./scripts/start-local-dev.sh

# 2. Send test email
./scripts/send-test-email.sh

# 3. Check status
./scripts/check-local-status.sh
```

### Critical Requirements
- **Hybrid Mode**: Node.js installed, Claude authenticated locally
- **Docker Mode**: WORKSPACE_PATH must be `/workspace` in `.env.local`
- **Both**: Repository must be `jscotthorn/amelia-astro.git`, GitHub Token required
- See `/docs/LOCAL_DEV_GUIDE.md` for complete setup

### If Services Won't Start
```bash
# For Docker mode issues:
./scripts/start-local-dev.sh --clean

# Nuclear option
docker stop hermes-manual claude-manual
docker rm hermes-manual claude-manual
docker buildx prune -af
```

## Production Commands
```bash
# Scale to zero (save money)
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --desired-count 0

# Check site
open https://edit.amelia.webordinary.com

# View logs
AWS_PROFILE=personal aws logs tail /ecs/webordinary/edit --since 10m
```

## Removed (Don't Use)
- ❌ Port 8080, Express servers
- ❌ ALB web routing
- ❌ CLIENT_ID, REPO_URL env vars
- ❌ Session-per-container

See component CLAUDE.md files for specifics.