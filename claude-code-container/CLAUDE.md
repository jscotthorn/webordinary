# Claude Development Notes - Container Build & Deployment

## 🚨 CRITICAL: Docker Architecture for AWS ECS

### Always Build for linux/amd64
AWS Fargate runs on x86_64 architecture. When building on Apple Silicon (M1/M2/M3) Macs, you MUST specify the platform:

```bash
# ✅ CORRECT - Always use this for production
docker build --platform linux/amd64 -t webordinary/claude-code-astro:latest .

# ❌ WRONG - Will fail with "exec format error" on ECS
docker build -t webordinary/claude-code-astro:latest .
```

### Common Architecture Errors
If you see these errors in CloudWatch logs, it's an architecture mismatch:
- `exec /app/scripts/entrypoint.sh: exec format error`
- `exec /usr/local/bin/docker-entrypoint.sh: exec format error`
- `standard_init_linux.go: exec user process caused "exec format error"`

### Build & Deploy Workflow
```bash
# 1. Build with correct architecture
docker build --platform linux/amd64 -t webordinary/claude-code-astro:latest .

# 2. Tag for ECR
docker tag webordinary/claude-code-astro:latest \
  942734823970.dkr.ecr.us-west-2.amazonaws.com/webordinary/claude-code-astro:latest

# 3. Login to ECR
AWS_PROFILE=personal aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin 942734823970.dkr.ecr.us-west-2.amazonaws.com

# 4. Push to ECR
docker push 942734823970.dkr.ecr.us-west-2.amazonaws.com/webordinary/claude-code-astro:latest

# 5. Force ECS deployment
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --force-new-deployment \
  --region us-west-2
```

## 📦 Container Architecture

### Current Setup (Task 23 - MVP)
- **Port 8080**: Express web server serving static Astro files + API endpoints
- **Build Process**: Astro project built once at container startup
- **Static Serving**: Express serves built files from `/workspace/dist`

### Key Services
1. **WebServerService** (`src/services/web-server.service.ts`)
   - Serves static Astro build output
   - Health check endpoint at `/health`
   - API placeholder at `/api/*`
   - Session routing: `/session/{sessionId}/*`

2. **AutoSleepService** (`src/services/auto-sleep.service.ts`)
   - Monitors container activity
   - Updates DynamoDB with last activity timestamps
   - Auto-terminates after idle timeout

3. **GitService** (`src/services/git.service.ts`)
   - Manages Git repository initialization
   - Configures safe directories for EFS mounts
   - Handles GitHub authentication

## 🔧 Development Tips

### Local Testing
```bash
# Build and run locally (use --platform for consistency)
docker build --platform linux/amd64 -t test-container .
docker run -p 8080:8080 -e GITHUB_TOKEN=your_token test-container

# Test health endpoint
curl http://localhost:8080/health
```

### Debugging Container Issues
1. Check CloudWatch logs: `/ecs/webordinary/edit`
2. Verify task status:
   ```bash
   AWS_PROFILE=personal aws ecs describe-tasks \
     --cluster webordinary-edit-cluster \
     --tasks <task-id> \
     --query 'tasks[0].{Status:lastStatus, StoppedReason:stoppedReason}'
   ```

### Environment Variables
```bash
# Required for container operation
WORKSPACE_PATH=/workspace        # Where Astro project lives
GITHUB_TOKEN=ghp_xxx             # For private repo access
AUTO_SHUTDOWN_MINUTES=20         # Idle timeout
CONTAINER_ID=<client>-<project>  # Container identifier
SESSION_ID=<session-uuid>        # Current session
```

## 🚀 Deployment Checklist

Before deploying a new container version:
- [ ] Built with `--platform linux/amd64`
- [ ] Tested health check endpoint locally
- [ ] Verified TypeScript compilation (`npm run build`)
- [ ] Checked for architecture-specific dependencies
- [ ] Tagged with appropriate version (not just `:latest`)
- [ ] Verified ECR repository exists
- [ ] Confirmed ECS service has sufficient CPU/memory

## 🐛 Common Issues & Solutions

### Container Fails to Start
1. **Architecture mismatch**: Rebuild with `--platform linux/amd64`
2. **Missing dependencies**: Check `npm ci` output in Dockerfile
3. **TypeScript errors**: Run `npm run build` locally first
4. **Port conflicts**: Ensure only port 8080 is exposed

### Astro Build Failures
1. **No package.json**: Container expects initialized Astro project
2. **Missing node_modules**: Ensure `npm install` runs in workspace
3. **Permission issues**: Check EFS mount permissions
4. **Memory constraints**: Increase container memory allocation

### Session Routing Issues
1. **No active session**: Verify session exists in DynamoDB
2. **Container not mapped**: Check `webordinary-containers` table
3. **Wrong port**: Session router expects port 8080 (not 4321)
4. **Health check failing**: Container won't receive traffic until healthy

## 📝 Notes for Future Claudes

1. **Always use `--platform linux/amd64`** when building Docker images for AWS
2. **Check architecture first** if containers fail with exec format errors
3. **The web server runs on port 8080**, not 4321 (Astro dev server removed)
4. **Static files are served** from built Astro output, not dev server
5. **Session routing** requires both DynamoDB tables to be populated
6. **Email processing** creates sessions that spawn containers automatically
7. **Use AWS_PROFILE=personal** for all AWS CLI commands in this project

## 🔄 Recent Changes (Task 23)

- Removed Astro dev server in favor of static build + Express
- Simplified to single port (8080) architecture
- Added WebServerService for unified HTTP handling
- Fixed architecture issues with explicit platform builds
- Integrated with existing session routing infrastructure