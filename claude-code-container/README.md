# Claude Code Container

A containerized environment for running Claude Code in AWS Fargate with Astro development server support. Evolving from HTTP API-based to SQS message-based architecture.

## Architecture Evolution

### Current Architecture (HTTP-based)
- Express API server on port 8080
- Astro dev server on port 4321
- WebSocket proxy on port 4322
- Thread-based workspace isolation

### Next-Generation Architecture (Sprint 4-5)
- **No Express Server**: Removed in Sprint 5
- **SQS Message Processing**: Replaces HTTP APIs
- **Multi-Session Support**: One container handles multiple chat threads
- **Interrupt Handling**: Graceful switching between sessions
- **Simplified Ports**: Only port 4321 for Astro preview

## Core Components

### ThreadManager (`src/thread-manager.ts`)
- **Purpose**: Manages user workspaces and Git branch isolation
- **Features**:
  - Creates isolated workspace directories at `/workspace/{clientId}/{userId}/project`
  - Manages thread-specific Git branches (`thread-{chatThreadId}`)
  - Handles GitHub authentication with personal access tokens
  - Configures Git safe directories for EFS-mounted volumes
- **Status**: ✅ Fully operational

### AstroManager (`src/astro-manager.ts`)
- **Purpose**: Manages Astro development server lifecycle
- **Features**:
  - Spawns `npx astro dev --host 0.0.0.0 --port 4321`
  - WebSocket support for HMR
  - Health checking with timeout
  - Process management (start/stop/restart)
- **Status**: ✅ Operational

### ClaudeExecutor (`src/claude-executor.ts`)
- **Purpose**: Executes Claude Code commands
- **Current**: Direct Claude Code CLI integration
- **Future**: Interrupt handling for session switching
- **Status**: ✅ Working with Bedrock

### MultiSessionProcessor (New - Sprint 4)
- **Purpose**: Poll multiple SQS queues for different sessions
- **Features**:
  - Dynamic queue discovery via DynamoDB
  - Interrupt handling for session switching
  - Git branch switching per session
  - Auto-commit on interrupts
- **Status**: 🚧 In development

## Container Configuration

### Environment Variables
```bash
# Current (HTTP-based)
GITHUB_TOKEN          # GitHub personal access token
AUTO_SHUTDOWN_MINUTES # Idle timeout (default: 20)
WORKSPACE_PATH       # EFS mount point (default: /workspace)
PORT                 # API server port (default: 8080)

# New (SQS-based) - Sprint 4-5
CONTAINER_ID         # {clientId}-{projectId}-{userId}
CLIENT_ID            # Client identifier
PROJECT_ID           # Project identifier  
USER_ID              # User identifier
# No INPUT_QUEUE_URL - discovers queues dynamically
```

## Migration Path

### Sprint 4: Add SQS Support
1. Keep Express API for backward compatibility
2. Add SQS polling alongside HTTP endpoints
3. Implement queue discovery mechanism
4. Add interrupt handling logic
5. Test with both communication methods

### Sprint 5: Remove HTTP Dependencies
1. Remove Express server completely
2. Remove port 8080 from Dockerfile
3. Update health checks to use SQS
4. Simplify container to just Astro + SQS
5. Update CDK to remove API target groups

## Deployment

### Current Build Process
```bash
./build.sh
# Builds Docker image
# Tags as latest
# Pushes to ECR: 942734823970.dkr.ecr.us-west-2.amazonaws.com/webordinary/claude-code-astro
```

### New Simplified Dockerfile (Sprint 5)
```dockerfile
FROM node:18-alpine
RUN apk add --no-cache git
RUN npm install -g @anthropic/claude-code

WORKDIR /app
COPY dist/ ./dist/
COPY package*.json ./

RUN npm ci --production
RUN mkdir -p /workspace

EXPOSE 4321
CMD ["node", "dist/index.js"]
```

## Testing

### Local Testing (Current)
```bash
docker run -p 8080:8080 -p 4321:4321 \
  -e GITHUB_TOKEN=your_token \
  -v $(pwd)/test-workspace:/workspace \
  webordinary/claude-code-astro:latest
```

### Local Testing (New Architecture)
```bash
# Set up local SQS queues (using LocalStack or AWS)
# Run container with queue URLs
docker run -p 4321:4321 \
  -e CONTAINER_ID=test-project-user \
  -e AWS_ACCESS_KEY_ID=xxx \
  -e AWS_SECRET_ACCESS_KEY=xxx \
  webordinary/claude-code-astro:next
```

## Cost Benefits

### Current Architecture
- Complex port management (8080, 4321, 4322)
- One container per thread (inefficient)
- HTTP API overhead

### New Architecture
- Single port (4321) for Astro only
- One container per user+project (efficient)
- SQS costs <$1/month for thousands of messages
- Better container utilization
- Simpler operations

## Known Issues & Solutions

### Resolved ✅
1. **EFS Mounting**: Fixed with security groups
2. **GitHub Auth**: Fixed with credential helper
3. **Port Mapping**: Will be simplified in Sprint 5
4. **Container Startup**: Optimized in Sprint 5

### In Progress 🚧
1. **Session Switching**: Implementing interrupt handling
2. **Queue Discovery**: Building DynamoDB integration
3. **Container Simplification**: Removing Express dependencies

## Monitoring

### Current Metrics
- API response times
- Container CPU/memory
- Astro server health

### New Metrics (Sprint 4-5)
- Queue processing rate
- Interrupt frequency
- Session switch time
- DLQ message count
- Container efficiency (sessions per container)

## Future Enhancements

### Sprint 4 Deliverables
- Multi-queue SQS polling
- Session interrupt handling
- Dynamic queue discovery
- Integration testing

### Sprint 5 Deliverables
- Remove Express server
- Simplify container image
- Optimize resource usage
- Production deployment

### Post Sprint 5
- WebContainer support for browser-based editing
- Multi-region deployment
- Advanced caching strategies
- Real-time collaboration features

## Support

For issues or questions:
- Check CloudWatch logs: `/ecs/webordinary/edit`
- Review task documentation in `/tasks/sprint-4/` and `/tasks/sprint-5/`
- Monitor SQS queue metrics in CloudWatch
- Check DynamoDB for session mappings