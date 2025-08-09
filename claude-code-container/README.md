# Claude Code Container

A containerized environment for running Claude Code in AWS Fargate with Astro development server support.

## Architecture

### Core Components

#### ThreadManager (`src/thread-manager.ts`)
- **Purpose**: Manages user workspaces and Git branch isolation
- **Features**:
  - Creates isolated workspace directories at `/workspace/{clientId}/{userId}/project`
  - Manages thread-specific Git branches (`thread-{threadId}`)
  - Handles GitHub authentication with personal access tokens
  - Configures Git safe directories for EFS-mounted volumes
  - **Status**: ✅ Fully operational

#### AstroManager (`src/astro-manager.ts`)
- **Purpose**: Manages Astro development server lifecycle
- **Features**:
  - Spawns `npm run dev` process on port 4321
  - WebSocket proxy on port 4322 for HMR
  - Health checking with 30-second timeout
  - Process management (start/stop/restart)
- **Status**: ⚠️ Process spawns but Astro not serving content

#### ClaudeExecutor (`src/claude-executor.ts`)
- **Purpose**: Executes Claude Code commands
- **Current**: Simulation mode (returns mock responses)
- **Future**: Will integrate with AWS Bedrock in Task 03
- **Status**: ✅ Simulation working

#### Express Server (`src/server.ts`)
- **Port**: 8080
- **Endpoints**:
  - `GET /health` - Health check endpoint
  - `POST /api/init` - Initialize workspace with repo clone
  - `POST /api/execute` - Execute Claude instruction
  - `GET /api/status/:clientId/:userId/:threadId` - Workspace status
  - `POST /api/git/*` - Git operations (commit, push, pull, etc.)
  - `POST /api/astro/*` - Astro server control
  - `POST /api/claude/:sessionId/*` - Hermes integration endpoints
- **Status**: ✅ All API endpoints operational

## Docker Configuration

### Base Image
- `node:20-slim` - Lightweight Node.js runtime

### Build Process
1. Multi-stage build for optimization
2. TypeScript compilation in builder stage
3. Production dependencies only in final image
4. Image size: ~709MB

### Environment Variables
```bash
# Required
GITHUB_TOKEN          # GitHub personal access token for repo access
AUTO_SHUTDOWN_MINUTES # Idle timeout (default: 20)

# Optional
WORKSPACE_PATH       # EFS mount point (default: /workspace)
PORT                 # API server port (default: 8080)
ASTRO_PORT          # Astro dev server port (default: 4321)
DEFAULT_CLIENT_ID    # Default client for testing
DEFAULT_USER_ID      # Default user for testing
```

## Scripts

### entrypoint.sh
- Validates GitHub token
- Configures Git credentials
- Sets up workspace permissions (⚠️ NOTE: Only sets root dir, not recursive)
- Starts auto-shutdown monitor
- Launches Express server

**Critical**: Do NOT use recursive chown/chmod on EFS mount - it will cause container startup to hang and health checks to fail!

### auto-shutdown.sh
- Monitors container activity
- Shuts down after idle timeout
- Reports status to DynamoDB (when configured)
- Legacy system - will be replaced with Lambda-based cleanup

## Known Issues

### ⚠️ Astro Host Header Validation
**Problem**: Astro/Vite blocks requests with host header `edit.amelia.webordinary.com`  
**Symptoms**:
- Returns 403 "Blocked request. This host is not allowed"
- Requires configuration in project's vite.config.js

**Workarounds**:
1. Configure `server.allowedHosts` in the Astro project's vite.config.js
2. Use reverse proxy through Express server
3. Access through session-based paths with proper headers

### ✅ Resolved Issues
1. **EFS Mounting**: Fixed with proper security group configuration
2. **GitHub Auth**: Fixed with credential helper and token injection
3. **Git Ownership**: Fixed with safe.directory configuration
4. **Port Mapping**: Fixed with explicit target group configuration
5. **Astro Binding**: Fixed with `npx astro dev --host 0.0.0.0`
6. **Container Startup Hang**: Fixed by removing recursive chown on EFS mount
7. **Health Check Failures**: Fixed with proper path, timeout, and grace period

## Deployment

### Build and Push
```bash
./build.sh
# Builds Docker image
# Tags as latest and v1.0.0
# Pushes to ECR: 942734823970.dkr.ecr.us-west-2.amazonaws.com/webordinary/claude-code-astro
```

### Local Testing
```bash
docker run -p 8080:8080 \
  -e GITHUB_TOKEN=your_token \
  -v $(pwd)/test-workspace:/workspace \
  webordinary/claude-code-astro:latest
```

### Fargate Deployment
Managed by CDK in `hephaestus/lib/fargate-stack.ts`
```bash
cd ../hephaestus
npx cdk deploy FargateStack --profile personal
```

## API Usage Examples

### Initialize Workspace
```bash
curl -X POST https://edit.amelia.webordinary.com/api/init \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "test-client",
    "userId": "user1",
    "threadId": "main",
    "repoUrl": "https://github.com/jscotthorn/amelia-astro.git"
  }'
```

### Execute Command (Simulation Mode)
```bash
curl -X POST https://edit.amelia.webordinary.com/api/execute \
  -H "Content-Type: application/json" \
  -d '{
    "instruction": "Update the homepage title",
    "clientId": "test-client",
    "userId": "user1",
    "threadId": "main"
  }'
```

## Development Workflow

1. **Make Changes**: Edit TypeScript source files
2. **Build Container**: Run `./build.sh`
3. **Deploy**: Update Fargate service with new image
4. **Test**: Use curl or Postman to test endpoints
5. **Monitor**: Check CloudWatch logs for debugging

## Future Enhancements

1. **Bedrock Integration** (Task 03): Replace simulation with real Claude
2. **Astro Fix**: Debug and resolve dev server startup issue
3. **DynamoDB Integration**: Workspace status tracking
4. **Lambda Cleanup**: Replace auto-shutdown with serverless cleanup
5. **Metrics**: CloudWatch custom metrics for monitoring

## Support

For issues or questions:
- Check CloudWatch logs: `/ecs/webordinary/edit`
- Review `INFRASTRUCTURE_STATUS.md` for current state
- Contact DevOps team for AWS access issues