# Task 18: Remove Express API Server from Container

## Objective
Remove the Express API server from the edit container since all communication now happens through SQS queues, simplifying the container architecture.

## Requirements

### Code Removal
1. **Remove Express Dependencies**:
   - Remove express, body-parser, cors packages
   - Remove HTTP-related types and interfaces
   - Update package.json and lock file

2. **Remove API Endpoints**:
   - Delete server.ts file
   - Remove all HTTP route handlers
   - Remove health check endpoint (replace with SQS-based health)

3. **Simplify Entry Point**:
   - Update main entry to start only Astro and SQS processor
   - Remove port 8080 references
   - Update Docker EXPOSE directives

## Implementation Steps

1. Delete Express server code
2. Update container entry point
3. Modify Dockerfile
4. Update CDK task definition
5. Remove ALB target group for port 8080

## Updated Container Structure

```typescript
// claude-code-container/src/index.ts
import { AstroManager } from './astro-manager';
import { MultiSessionProcessor } from './multi-session-processor';
import { ThreadManager } from './thread-manager';

async function main() {
  console.log('Starting Webordinary Edit Container');
  
  // Get container configuration
  const config = {
    clientId: process.env.CLIENT_ID!,
    projectId: process.env.PROJECT_ID!,
    userId: process.env.USER_ID!,
    workspacePath: process.env.WORKSPACE_PATH || '/workspace',
    repoUrl: process.env.REPO_URL
  };
  
  console.log(`Container: ${config.clientId}-${config.projectId}-${config.userId}`);
  
  try {
    // Initialize workspace
    const threadManager = new ThreadManager();
    await threadManager.initializeWorkspace(
      config.clientId,
      config.userId,
      config.projectId,
      config.repoUrl
    );
    
    // Start Astro dev server
    const astro = new AstroManager(config.workspacePath);
    await astro.start();
    console.log('Astro dev server running on port 4321');
    
    // Start SQS processor
    const processor = new MultiSessionProcessor(threadManager, astro);
    await processor.start();
    console.log('SQS processor started');
    
    // Handle shutdown
    process.on('SIGTERM', async () => {
      console.log('Received SIGTERM, shutting down gracefully');
      await processor.stop();
      await astro.stop();
      process.exit(0);
    });
    
    process.on('SIGINT', async () => {
      console.log('Received SIGINT, shutting down gracefully');
      await processor.stop();
      await astro.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Failed to start container:', error);
    process.exit(1);
  }
}

main().catch(console.error);
```

## Updated Dockerfile

```dockerfile
FROM node:18-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install AWS CLI
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip aws

# Install Claude Code CLI
RUN npm install -g @anthropic/claude-code

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --production

# Copy application code
COPY dist/ ./dist/
COPY scripts/ ./scripts/

# Create workspace directory
RUN mkdir -p /workspace

# Only expose Astro port
EXPOSE 4321

# Health check via SQS (no HTTP endpoint)
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
    CMD node dist/health-check.js || exit 1

# Start container
CMD ["node", "dist/index.js"]
```

## CDK Updates

```typescript
// hephaestus/lib/fargate-stack.ts
// Remove port 8080 mapping
const container = taskDefinition.addContainer('edit-container', {
  image: ecs.ContainerImage.fromEcr(ecrRepo),
  portMappings: [
    {
      containerPort: 4321,
      protocol: ecs.Protocol.TCP,
      name: 'astro'
    }
    // Remove port 8080 mapping
  ],
  environment: {
    // ... environment variables
  }
});

// Remove API target group
// Only keep Astro target group
const astroTargetGroup = new elbv2.ApplicationTargetGroup(
  this,
  'AstroTargetGroup',
  {
    vpc,
    port: 4321,
    protocol: elbv2.ApplicationProtocol.HTTP,
    targetType: elbv2.TargetType.IP,
    healthCheck: {
      path: '/',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3
    }
  }
);

// Remove API listener rule
// Only route to Astro for preview
httpsListener.addRules('EditRouting', {
  priority: 10,
  conditions: [
    elbv2.ListenerCondition.hostHeaders(['edit.*.webordinary.com']),
    elbv2.ListenerCondition.pathPatterns(['/session/*'])
  ],
  actions: [
    elbv2.ListenerAction.forward([astroTargetGroup])
  ]
});
```

## SQS-Based Health Check

```typescript
// claude-code-container/dist/health-check.js
const { SQSClient, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');

async function checkHealth() {
  const containerId = process.env.CONTAINER_ID;
  
  try {
    // Check if we can access DynamoDB
    const dynamodb = new DynamoDBClient({ region: 'us-west-2' });
    const containerInfo = await dynamodb.send(new GetItemCommand({
      TableName: 'webordinary-containers',
      Key: { containerId: { S: containerId } }
    }));
    
    if (!containerInfo.Item) {
      console.error('Container not registered in DynamoDB');
      process.exit(1);
    }
    
    // Check if Astro is responding
    const response = await fetch('http://localhost:4321');
    if (!response.ok && response.status !== 404) {
      console.error('Astro dev server not responding');
      process.exit(1);
    }
    
    console.log('Health check passed');
    process.exit(0);
  } catch (error) {
    console.error('Health check failed:', error);
    process.exit(1);
  }
}

checkHealth();
```

## Testing Checklist
- [ ] Container starts without Express
- [ ] Astro dev server accessible on 4321
- [ ] SQS processor starts correctly
- [ ] Health checks work via SQS
- [ ] No references to port 8080
- [ ] ALB routing updated

## Rollback Plan
1. Keep Express code in version control
2. Tag container image before changes
3. Test in staging environment first
4. Monitor for issues after deployment
5. Revert CDK changes if needed