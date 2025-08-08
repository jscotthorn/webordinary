# Task 01: Create Claude Code SDK Docker Container

## Overview
Build a Docker container that runs Claude Code SDK alongside Astro dev server, providing a complete live-editing environment for AI-powered content management with instant preview capabilities.

## Business Requirements
- Enable Claude Code to edit Astro site files directly
- Provide instant preview updates via Astro dev server HMR
- Support git operations for version control
- Maintain security with proper secret management
- Optimize for fast startup and low memory usage

## Technical Requirements

### 1. Base Image Selection
- **Base**: `node:20-slim` (smaller footprint than full Node image)
- **Size target**: < 1GB total image size
- **Multi-stage build**: Separate build and runtime stages

### 2. Required Software Components

#### System Dependencies
```dockerfile
# Essential tools
- git (2.40+)
- curl
- ca-certificates
- python3 (for Claude Code SDK)
- build-essential (for native Node modules)
```

#### Node.js Components
```json
{
  "@anthropic/claude-code-sdk": "^1.0.0",
  "astro": "^5.5.2",
  "express": "^4.18.0",
  "ws": "^8.0.0",
  "nodemon": "^3.0.0",
  "tsx": "^4.0.0"
}
```

#### Claude Code SDK Configuration
```typescript
// /app/config/claude-code.config.ts
export default {
  apiKey: process.env.ANTHROPIC_API_KEY,
  mode: 'non-interactive',
  tools: [
    'file_read',
    'file_write',
    'file_edit',
    'git_status',
    'git_commit',
    'bash_command'
  ],
  workingDirectory: '/workspace',
  maxTokens: 8192,
  model: 'claude-3-opus-20240229'
}
```

### 3. Container Architecture

```
/
├── app/                    # Application code
│   ├── server.ts          # Express API server
│   ├── claude-executor.ts # Claude Code SDK wrapper
│   ├── astro-manager.ts  # Astro dev server manager
│   ├── websocket-proxy.ts # WebSocket proxy for HMR
│   └── thread-manager.ts  # Thread/branch manager
├── workspace/             # EFS mount point (persistent)
│   ├── {client}/          # Client directory
│   │   └── {user}/       # User workspace
│   │       ├── project/  # Single git repo (all branches)
│   │       ├── .claude/  # Claude threads
│   │       └── metadata.json
├── scripts/
│   ├── entrypoint.sh     # Container entrypoint
│   ├── health-check.sh   # Health check script
│   ├── auto-shutdown.sh  # Idle timeout handler
│   └── workspace-init.sh # Initialize user workspace
└── tmp/                   # Temporary files
```

### 4. API Server Implementation

```typescript
// /app/server.ts
import express from 'express';
import { ClaudeExecutor } from './claude-executor';
import { AstroManager } from './astro-manager';
import { ThreadManager } from './thread-manager';

const app = express();
const threadManager = new ThreadManager();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    workspace: process.env.WORKSPACE_PATH,
    client: process.env.CLIENT_ID,
    thread: process.env.THREAD_ID
  });
});

// Initialize workspace for client/user/thread
app.post('/api/init', async (req, res) => {
  const { clientId, userId, threadId, repoUrl } = req.body;
  
  try {
    const workspace = await threadManager.initializeWorkspace(
      clientId,
      userId,
      threadId,
      repoUrl
    );
    
    // Start Astro dev server in the workspace (if not already running)
    const astro = new AstroManager(workspace.projectPath);
    if (!astro.isRunning()) {
      await astro.start();
    }
    
    res.json({ 
      success: true, 
      workspace,
      resumed: workspace.resumed,
      branch: workspace.branch 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Execute Claude Code instruction with thread persistence
app.post('/api/execute', async (req, res) => {
  const { instruction, clientId, userId, threadId, mode = 'execute' } = req.body;
  
  try {
    // Ensure we're on the right branch
    const workspace = await threadManager.switchToThread(clientId, userId, threadId);
    const claude = new ClaudeExecutor(workspace);
    
    // Load thread context
    const context = await threadManager.loadThreadContext(clientId, userId, threadId);
    
    const result = await claude.execute({
      instruction,
      mode,
      context: {
        ...context,
        workingDirectory: workspace.projectPath,
        gitBranch: workspace.branch,
        threadId
      }
    });
    
    // Save thread context
    await threadManager.saveThreadContext(clientId, userId, threadId, result.context);
    
    // Auto-commit changes to thread branch
    await threadManager.commitChanges(
      workspace.projectPath,
      `Thread ${threadId}: ${instruction.substring(0, 50)}...`
    );
    
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(8080);
```

### 5. Thread Manager for Persistent Workspaces

```typescript
// /app/thread-manager.ts
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ThreadManager {
  private baseDir = '/workspace';
  
  async initializeWorkspace(clientId: string, userId: string, threadId: string, repoUrl?: string) {
    const userPath = path.join(this.baseDir, clientId, userId);
    const projectPath = path.join(userPath, 'project');
    const claudePath = path.join(userPath, '.claude');
    const threadsPath = path.join(claudePath, 'threads');
    
    // Check if user workspace exists
    const userExists = await this.pathExists(userPath);
    
    if (!userExists) {
      // First time for this user - create workspace and clone
      console.log(`Creating workspace for ${clientId}/${userId}`);
      await fs.mkdir(userPath, { recursive: true });
      await fs.mkdir(claudePath, { recursive: true });
      await fs.mkdir(threadsPath, { recursive: true });
      
      if (repoUrl) {
        console.log(`Cloning repository to ${projectPath}`);
        await execAsync(`git clone ${repoUrl} ${projectPath}`);
        await execAsync(`cd ${projectPath} && npm install`);
      } else {
        await fs.mkdir(projectPath, { recursive: true });
      }
      
      await this.saveUserMetadata(clientId, userId, {
        created: new Date().toISOString(),
        repoUrl
      });
    }
    
    // Switch to thread branch
    const branch = `thread-${threadId}`;
    const branchExists = await this.branchExists(projectPath, branch);
    
    if (branchExists) {
      console.log(`Switching to existing branch: ${branch}`);
      await execAsync(`cd ${projectPath} && git checkout ${branch}`);
    } else {
      console.log(`Creating new branch: ${branch}`);
      await execAsync(`cd ${projectPath} && git checkout -b ${branch}`);
    }
    
    return {
      userPath,
      projectPath,
      claudePath,
      branch,
      resumed: branchExists
    };
  }
  
  async switchToThread(clientId: string, userId: string, threadId: string) {
    const projectPath = path.join(this.baseDir, clientId, userId, 'project');
    const branch = `thread-${threadId}`;
    
    // Stash any uncommitted changes
    await execAsync(`cd ${projectPath} && git stash`);
    
    // Switch branch
    await execAsync(`cd ${projectPath} && git checkout ${branch}`);
    
    return {
      projectPath,
      branch,
      claudePath: path.join(this.baseDir, clientId, userId, '.claude')
    };
  }
  
  async commitChanges(projectPath: string, message: string) {
    try {
      await execAsync(`cd ${projectPath} && git add -A`);
      await execAsync(`cd ${projectPath} && git commit -m "${message}"`);
    } catch (e) {
      // No changes to commit
      console.log('No changes to commit');
    }
  }
  
  async loadThreadContext(clientId: string, userId: string, threadId: string) {
    const threadPath = path.join(this.baseDir, clientId, userId, '.claude', 'threads', `${threadId}.json`);
    
    if (await this.pathExists(threadPath)) {
      const content = await fs.readFile(threadPath, 'utf-8');
      return JSON.parse(content);
    }
    
    return {
      history: [],
      plans: [],
      threadId,
      branch: `thread-${threadId}`
    };
  }
  
  async saveThreadContext(clientId: string, userId: string, threadId: string, context: any) {
    const threadPath = path.join(this.baseDir, clientId, userId, '.claude', 'threads', `${threadId}.json`);
    await fs.writeFile(threadPath, JSON.stringify(context, null, 2));
    
    // Update last accessed time
    await this.updateUserLastAccessed(clientId, userId);
  }
  
  private async branchExists(projectPath: string, branch: string): Promise<boolean> {
    try {
      await execAsync(`cd ${projectPath} && git rev-parse --verify ${branch}`);
      return true;
    } catch {
      return false;
    }
  }
  
  private async pathExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
  
  private async saveUserMetadata(clientId: string, userId: string, metadata: any) {
    const metadataPath = path.join(this.baseDir, clientId, userId, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }
  
  private async updateUserLastAccessed(clientId: string, userId: string) {
    const metadataPath = path.join(this.baseDir, clientId, userId, 'metadata.json');
    
    if (await this.pathExists(metadataPath)) {
      const content = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(content);
      metadata.lastAccessed = new Date().toISOString();
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    }
  }
}
```

### 6. Astro Dev Server Manager

```typescript
// /app/astro-manager.ts
import { spawn } from 'child_process';
import { WebSocketServer } from 'ws';

export class AstroManager {
  private process: ChildProcess | null = null;
  private wsProxy: WebSocketServer;
  private projectPath: string;
  
  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }
  
  async start() {
    // Check if node_modules exists (skip install if cached)
    const modulesExist = await this.pathExists(`${this.projectPath}/node_modules`);
    
    if (!modulesExist) {
      console.log('First run - installing dependencies...');
      await this.runCommand('npm', ['install'], this.projectPath);
    } else {
      console.log('Using cached node_modules');
    }
    
    // Kill any existing process
    if (this.process) {
      this.process.kill();
    }
    
    // Start Astro dev server
    this.process = spawn('npm', ['run', 'dev'], {
      cwd: this.projectPath,
      env: {
        ...process.env,
        HOST: '0.0.0.0',
        PORT: '4321'
      }
    });
    
    // Set up WebSocket proxy for HMR
    this.setupWebSocketProxy();
    
    // Wait for server to be ready
    await this.waitForReady();
  }
  
  private setupWebSocketProxy() {
    this.wsProxy = new WebSocketServer({ port: 4322 });
    
    this.wsProxy.on('connection', (ws) => {
      // Proxy WebSocket messages for HMR
      const astroWs = new WebSocket('ws://localhost:4321/_astro');
      
      ws.on('message', (data) => astroWs.send(data));
      astroWs.on('message', (data) => ws.send(data));
    });
  }
  
  private async waitForReady(timeout = 30000) {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      try {
        const response = await fetch('http://localhost:4321');
        if (response.ok) return true;
      } catch (e) {
        // Server not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('Astro server failed to start');
  }
}
```

### 6. Dockerfile

```dockerfile
# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm install -g typescript tsx

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN tsc

# Runtime stage
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code SDK CLI
RUN npm install -g @anthropic/claude-code-cli

# Create app user
RUN useradd -m -s /bin/bash appuser

# Set up directories
WORKDIR /app
RUN mkdir -p /workspace /tmp/claude && \
    chown -R appuser:appuser /app /workspace /tmp/claude

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Copy scripts
COPY scripts/ ./scripts/
RUN chmod +x scripts/*.sh

# Switch to non-root user
USER appuser

# Expose ports
EXPOSE 8080 4321 4322

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD /app/scripts/health-check.sh

# Set environment variables
ENV NODE_ENV=production \
    CLAUDE_CODE_NON_INTERACTIVE=true \
    ASTRO_TELEMETRY_DISABLED=1

# Entrypoint
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
```

### 7. Entrypoint Script

```bash
#!/bin/bash
# /app/scripts/entrypoint.sh

set -e

# Check required environment variables
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "Error: ANTHROPIC_API_KEY is not set"
  exit 1
fi

if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GITHUB_TOKEN is not set"
  exit 1
fi

# Configure git
git config --global user.email "claude@webordinary.com"
git config --global user.name "Claude Code"
git config --global credential.helper store
echo "https://${GITHUB_TOKEN}@github.com" > ~/.git-credentials

# Ensure workspace directory exists (EFS mount point)
if [ ! -d "/workspace" ]; then
  echo "Error: /workspace directory not mounted"
  exit 1
fi

# Set proper permissions for EFS
chown -R appuser:appuser /workspace 2>/dev/null || true

# Log workspace info
echo "Workspace mounted at /workspace"
echo "Client: ${CLIENT_ID:-not_set}"
echo "Thread: ${THREAD_ID:-not_set}"

# Start auto-shutdown timer in background
/app/scripts/auto-shutdown.sh &

# Start the application
echo "Starting Claude Code server..."
exec tsx /app/dist/server.js
```

### 8. Auto-shutdown Script

```bash
#!/bin/bash
# /app/scripts/auto-shutdown.sh

IDLE_TIMEOUT=${AUTO_SHUTDOWN_MINUTES:-5}
LAST_ACTIVITY_FILE="/tmp/last_activity"

# Initialize activity timestamp
date +%s > $LAST_ACTIVITY_FILE

while true; do
  sleep 60
  
  LAST_ACTIVITY=$(cat $LAST_ACTIVITY_FILE 2>/dev/null || echo 0)
  CURRENT_TIME=$(date +%s)
  IDLE_TIME=$((CURRENT_TIME - LAST_ACTIVITY))
  IDLE_MINUTES=$((IDLE_TIME / 60))
  
  if [ $IDLE_MINUTES -ge $IDLE_TIMEOUT ]; then
    echo "Container idle for $IDLE_MINUTES minutes. Shutting down..."
    
    # Signal ECS to stop task
    curl -X POST http://169.254.170.2/v2/metadata \
      -H "Content-Type: application/json" \
      -d '{"reason": "idle-timeout"}'
    
    # Graceful shutdown
    kill -TERM 1
    exit 0
  fi
done
```

## Build and Push Process

```bash
# Get ECR repository URI from Task 00 outputs
ECR_URI=$(aws cloudformation describe-stacks \
  --stack-name ECRStack \
  --query 'Stacks[0].Outputs[?OutputKey==`RepositoryUri`].OutputValue' \
  --output text \
  --profile personal)

# Local build
docker build -t webordinary/claude-code-astro:latest .

# Tag for ECR
docker tag webordinary/claude-code-astro:latest $ECR_URI:latest

# Login to ECR
aws ecr get-login-password --region us-west-2 --profile personal | \
  docker login --username AWS --password-stdin $ECR_URI

# Push to ECR
docker push $ECR_URI:latest
```

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| ANTHROPIC_API_KEY | Claude API key | Yes | - |
| GITHUB_TOKEN | GitHub access token | Yes | - |
| REPO_URL | Git repository to clone | No | - |
| AUTO_SHUTDOWN_MINUTES | Idle timeout | No | 5 |
| ASTRO_DEV_MODE | Enable dev server | No | true |
| LOG_LEVEL | Logging verbosity | No | info |

## Security Considerations

1. **Non-root user**: Container runs as `appuser`, not root
2. **Secret management**: API keys from AWS Secrets Manager only
3. **Network isolation**: No outbound access except to allowed APIs
4. **Git credentials**: Stored securely with limited scope token
5. **File permissions**: Workspace limited to appuser ownership
6. **Image scanning**: ECR scanning enabled for vulnerabilities

## Performance Targets

- **Image size**: < 1GB
- **Startup time**: < 30 seconds to healthy state
- **Memory usage**: < 2GB under normal operation
- **CPU usage**: < 50% during idle
- **HMR latency**: < 200ms for file changes

## Acceptance Criteria

1. ✅ Docker image builds successfully
2. ✅ Container starts and passes health checks
3. ✅ Claude Code SDK executes instructions correctly
4. ✅ Astro dev server starts and serves pages
5. ✅ HMR WebSocket connections work
6. ✅ Git operations function properly
7. ✅ Auto-shutdown triggers after idle timeout
8. ✅ Secrets are not exposed in logs or environment
9. ✅ Image size < 1GB
10. ✅ Memory usage < 2GB during operation

## Testing Plan

1. Build image locally and test startup
2. Verify Claude Code SDK integration
3. Test Astro dev server and HMR
4. Validate git operations
5. Test auto-shutdown mechanism
6. Security scan with Trivy/Snyk
7. Load test with concurrent requests
8. Test with real Astro project

## Estimated Effort

- Dockerfile development: 1 day
- Application code: 1.5 days
- Testing and optimization: 1 day
- Documentation: 0.5 days
- **Total: 4 days**