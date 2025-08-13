# Container Quick Reference

**Build**: `docker build --platform linux/amd64 -t webordinary/claude-code .`
**Deploy**: `./build-and-push.sh`

## Critical
- No HTTP server (removed port 8080)
- S3 deployment only: `edit.{projectId}.webordinary.com`
- Project+user claiming (not session-based)
- Branch per thread: `thread-{chatThreadId}`

## Commands
```bash
# Logs
AWS_PROFILE=personal aws logs tail /ecs/webordinary/edit --since 10m

# Scale
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --desired-count 1

# Check S3
AWS_PROFILE=personal aws s3 ls s3://edit.amelia.webordinary.com/
```

## Environment
```bash
UNCLAIMED_QUEUE_URL  # Queue for available work
GITHUB_TOKEN         # Required for git operations
# No CLIENT_ID, REPO_URL, DEFAULT_USER_ID
```

## Fixes
- Exec format error → Add `--platform linux/amd64`
- S3 sync fails → Check AWS credentials
- Not claiming → Check unclaimed queue

See [README.md](README.md) for full documentation.