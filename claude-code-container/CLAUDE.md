# Claude Development Notes

## 🚨 CRITICAL: Always Build for linux/amd64
```bash
docker build --platform linux/amd64 -t webordinary/claude-code-astro:latest .
```
If you see "exec format error" in logs, it's an architecture mismatch.

## 📦 Current Architecture (S3 Deployment)
- **NO WEB SERVER**: Container doesn't serve HTTP (removed port 8080)
- **S3 DEPLOYMENT**: Builds Astro → Syncs to S3 bucket
- **SQS PROCESSING**: Receives messages, processes, deploys
- **CLOUDWATCH HEALTH**: No HTTP health checks, use logs

See README.md for full architecture details.

## 🔧 Quick Commands
```bash
# Deploy to ECS
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --force-new-deployment

# View logs
AWS_PROFILE=personal aws logs tail /ecs/webordinary/edit --since 10m

# Check S3 deployment
AWS_PROFILE=personal aws s3 ls s3://edit.amelia.webordinary.com/
```

## 🧪 Testing
```bash
# Tests use .env.local automatically
npm test all              # All tests
npm test container        # Quick container test
```

## 📝 Key Points
1. **Use AWS_PROFILE=personal** for all AWS commands
2. **Tests need GITHUB_TOKEN** in .env.local
3. **S3 bucket**: `edit.amelia.webordinary.com`
4. **No ALB routing** to containers for web traffic
5. **Git branches**: `thread-{chatThreadId}` per session

## 🐛 Common Fixes
- **Docker build fails**: Add `--platform linux/amd64`
- **Tests fail**: Check .env.local has GITHUB_TOKEN
- **No S3 updates**: Verify AWS credentials
- **Architecture errors**: Always use platform flag

See README.md for detailed troubleshooting.