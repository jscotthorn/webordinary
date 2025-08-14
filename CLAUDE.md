# WebOrdinary Quick Reference

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

### Quick Start
```bash
# 1. Start services
./scripts/start-local-dev.sh

# 2. Send test email
./scripts/send-test-email.sh

# 3. Check status
./scripts/check-local-status.sh
```

### Critical Requirements
- **WORKSPACE_PATH** must be `/workspace` in `.env.local`
- **Repository** must be `jscotthorn/amelia-astro.git` in Hermes config
- **GitHub Token** required in claude-code-container/.env.local
- See `/docs/LOCAL_DEV_GUIDE.md` for all fixes needed

### If Services Won't Start
```bash
# Clear cache and rebuild
./scripts/start-local-dev.sh --clean

# Nuclear option
docker stop hermes-manual claude-manual
docker rm hermes-manual claude-manual
docker buildx prune -af
./scripts/start-local-dev.sh
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