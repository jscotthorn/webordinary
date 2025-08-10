# Task 19: Simplify Container to Astro + SQS Processor Only

## Objective
Streamline the container to only run the Astro dev server and SQS message processor, removing all unnecessary complexity and dependencies.

## Simplification Areas

### 1. Dependencies Cleanup
- Remove unused npm packages
- Minimize Docker image size
- Use multi-stage builds
- Remove development dependencies

### 2. Code Structure
- Consolidate related modules
- Remove abstraction layers
- Simplify error handling
- Reduce configuration complexity

### 3. Process Management
- Single process for SQS polling
- Astro as child process
- Simplified shutdown handling
- Reduced memory footprint

## Implementation

### Minimal Package.json

```json
{
  "name": "webordinary-edit-container",
  "version": "2.0.0",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.0.0",
    "@aws-sdk/client-sqs": "^3.0.0",
    "@anthropic/claude-code": "^1.0.0",
    "simple-git": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^18.0.0",
    "typescript": "^5.0.0"
  }
}
```

### Consolidated Main File

```typescript
// claude-code-container/src/index.ts
import { spawn, ChildProcess } from 'child_process';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import simpleGit from 'simple-git';

class EditContainer {
  private astroProcess: ChildProcess | null = null;
  private claudeProcess: ChildProcess | null = null;
  private currentSession: string | null = null;
  private git: any;
  private sqs: SQSClient;
  private dynamodb: DynamoDBClient;
  private running = true;
  
  constructor(
    private config: {
      containerId: string;
      workspacePath: string;
      repoUrl?: string;
    }
  ) {
    this.sqs = new SQSClient({ region: 'us-west-2' });
    this.dynamodb = new DynamoDBClient({ region: 'us-west-2' });
    this.git = simpleGit(config.workspacePath);
  }
  
  async start() {
    // Initialize workspace
    await this.initWorkspace();
    
    // Start Astro
    await this.startAstro();
    
    // Start polling
    await this.pollQueues();
  }
  
  private async initWorkspace() {
    if (this.config.repoUrl) {
      console.log(`Cloning ${this.config.repoUrl}`);
      await this.git.clone(this.config.repoUrl, '.');
    }
    
    // Install dependencies
    await this.exec('npm', ['install'], this.config.workspacePath);
  }
  
  private async startAstro() {
    console.log('Starting Astro dev server');
    this.astroProcess = spawn('npx', ['astro', 'dev', '--host', '0.0.0.0', '--port', '4321'], {
      cwd: this.config.workspacePath,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    this.astroProcess.stdout?.on('data', (data) => {
      console.log(`[Astro] ${data}`);
    });
    
    // Wait for Astro to be ready
    await this.waitForAstro();
  }
  
  private async waitForAstro(timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const response = await fetch('http://localhost:4321');
        if (response.ok || response.status === 404) {
          console.log('Astro dev server ready');
          return;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('Astro failed to start');
  }
  
  private async pollQueues() {
    while (this.running) {
      const queues = await this.discoverQueues();
      
      for (const queue of queues) {
        const message = await this.receiveMessage(queue.inputUrl);
        if (message) {
          await this.processMessage(message, queue);
          break; // Process one at a time
        }
      }
      
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  private async discoverQueues() {
    const result = await this.dynamodb.send(new QueryCommand({
      TableName: 'webordinary-edit-sessions',
      IndexName: 'container-index',
      KeyConditionExpression: 'containerId = :cid',
      ExpressionAttributeValues: {
        ':cid': { S: this.config.containerId }
      }
    }));
    
    return (result.Items || []).map(item => ({
      sessionId: item.sessionId.S,
      inputUrl: item.inputQueueUrl.S,
      outputUrl: item.outputQueueUrl.S,
      branch: item.branch.S
    }));
  }
  
  private async receiveMessage(queueUrl: string) {
    const result = await this.sqs.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 5
    }));
    
    if (result.Messages?.[0]) {
      const message = result.Messages[0];
      await this.sqs.send(new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle
      }));
      return JSON.parse(message.Body!);
    }
    return null;
  }
  
  private async processMessage(message: any, queue: any) {
    // Handle session switch
    if (this.currentSession !== queue.sessionId) {
      if (this.currentSession) {
        await this.interruptCurrent();
      }
      await this.switchSession(queue);
    }
    
    // Execute command
    const result = await this.executeClaude(message);
    
    // Send response
    await this.sqs.send(new SendMessageCommand({
      QueueUrl: queue.outputUrl,
      MessageBody: JSON.stringify(result)
    }));
  }
  
  private async interruptCurrent() {
    if (this.claudeProcess) {
      this.claudeProcess.kill('SIGINT');
      await new Promise(r => setTimeout(r, 2000));
      await this.git.add('./*');
      await this.git.commit('Auto-save: Interrupted');
    }
  }
  
  private async switchSession(queue: any) {
    this.currentSession = queue.sessionId;
    await this.git.checkout(queue.branch);
  }
  
  private async executeClaude(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.claudeProcess = spawn('claude-code', [
        '--instruction', message.instruction
      ], {
        cwd: this.config.workspacePath
      });
      
      let output = '';
      this.claudeProcess.stdout?.on('data', (data) => {
        output += data;
      });
      
      this.claudeProcess.on('exit', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            output: output.trim(),
            commandId: message.commandId
          });
        } else {
          resolve({
            success: false,
            error: `Process exited with code ${code}`,
            commandId: message.commandId
          });
        }
      });
    });
  }
  
  private exec(command: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { cwd });
      proc.on('exit', (code) => {
        code === 0 ? resolve() : reject(new Error(`${command} failed`));
      });
    });
  }
  
  async stop() {
    this.running = false;
    this.astroProcess?.kill();
    this.claudeProcess?.kill();
  }
}

// Main entry
async function main() {
  const container = new EditContainer({
    containerId: process.env.CONTAINER_ID!,
    workspacePath: process.env.WORKSPACE_PATH || '/workspace',
    repoUrl: process.env.REPO_URL
  });
  
  process.on('SIGTERM', () => container.stop());
  process.on('SIGINT', () => container.stop());
  
  await container.start();
}

main().catch(console.error);
```

### Optimized Dockerfile

```dockerfile
# Build stage
FROM node:18-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build

# Runtime stage
FROM node:18-slim
RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*

# Install AWS CLI (minimal)
RUN curl -sL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "aws.zip" && \
    unzip -q aws.zip && ./aws/install --bin-dir /usr/local/bin --install-dir /usr/local/aws-cli && \
    rm -rf aws.zip aws

# Install Claude Code
RUN npm install -g @anthropic/claude-code

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

RUN mkdir -p /workspace
WORKDIR /workspace

EXPOSE 4321
CMD ["node", "/app/dist/index.js"]
```

## Resource Optimization

```yaml
# Reduced resource requirements
resources:
  cpu: 512        # Reduced from 1024
  memory: 1024    # Reduced from 2048
  
environment:
  NODE_OPTIONS: "--max-old-space-size=768"  # Limit Node memory
```

## Success Criteria
- [ ] Container size reduced by >50%
- [ ] Startup time <30 seconds
- [ ] Memory usage <1GB
- [ ] Single consolidated main file
- [ ] Minimal dependencies
- [ ] Clean shutdown handling

## Testing
- Measure container image size
- Monitor memory usage under load
- Test startup/shutdown times
- Verify all functionality works
- Check for memory leaks