# Task 05: Edit Mode Tracking & Intelligent Routing System

## Overview
Implement a dynamic routing system that intelligently directs traffic to either Fargate (live edit mode) or S3 (static production) based on active edit session tracking. This enables cost-effective resource usage while maintaining instant preview capabilities during active editing.

## ⚠️ Important Architecture Clarifications

Based on completed tasks, the following adjustments are needed:

### 1. **Bedrock vs Anthropic API**
- **Container (Task 01)**: Uses simulation mode, needs Bedrock integration
- **Hermes (Task 03)**: Currently uses Anthropic API via Claude Code SDK
- **Task 05 Update**: Must bridge this gap - Hermes will call container API, not Bedrock directly

### 2. **Existing Infrastructure (Task 00)**
- ALB already deployed: `webordinary-edit-alb-916355172.us-west-2.elb.amazonaws.com`
- EFS filesystem ready: `fs-0ab7a5e03c0dc5bfd`
- No Anthropic secret in AWS Secrets Manager (uses Bedrock IAM)
- GitHub token available in Secrets Manager

### 3. **Container Integration Pattern**
- Hermes (with Claude Code SDK) → HTTP API → Container (with git/Astro)
- Container doesn't need Claude/Bedrock - it just executes file operations
- Claude Code SDK in Hermes generates the plans/instructions

## Revised Architecture Flow

### Current State (from completed tasks):
```
1. Email → SQS → Hermes
2. Hermes uses Claude Code SDK (Anthropic API) to generate plan/instructions
3. Hermes calls Container API endpoints for file operations
4. Container executes git/file operations and runs Astro dev server
5. Container auto-commits and pushes changes (Task 04)
```

### Task 05 Addition:
```
6. DynamoDB tracks active edit sessions
7. CloudFront checks session state via Lambda@Edge
8. Routes to ALB→Fargate (active) or S3 (inactive)
9. Auto-scales Fargate based on session count
```

## Business Requirements
- Zero-cost standby mode when no editing is happening
- Instant activation when user starts editing (< 30s)
- Automatic transition to static mode after editing completes
- Session persistence for resuming work
- Multiple concurrent edit sessions support

## Technical Architecture

### Core Components

```mermaid
flowchart TD
    subgraph "CloudFront Distribution"
        CF[CloudFront] --> LE[Lambda@Edge<br>Router]
    end
    
    subgraph "State Management"
        DDB[(DynamoDB<br>Session State)]
        LE --> DDB
    end
    
    subgraph "Origins"
        LE -->|Edit Mode| ALB[ALB → Fargate]
        LE -->|Static Mode| S3[S3 Bucket]
    end
    
    subgraph "Session Lifecycle"
        API[Hermes API] --> DDB
        FG[Fargate Container] --> DDB
    end
    
    classDef active fill:#90EE90
    classDef inactive fill:#FFE4B5
    class ALB active
    class S3 inactive
```

## Implementation Details

### 1. DynamoDB Session State Table

**Table Name**: `webordinary-edit-sessions`

**Schema**:
```typescript
interface EditSession {
  // Partition Key
  sessionId: string;  // Format: {clientId}#{userId}#{threadId}
  
  // Attributes
  clientId: string;
  userId: string;
  threadId: string;
  status: 'initializing' | 'active' | 'draining' | 'inactive';
  
  // Fargate Details
  taskArn?: string;
  containerIp?: string;
  startedAt: string;
  lastActivityAt: string;
  
  // Git State
  branch: string;
  lastCommit?: string;
  isDirty: boolean;
  
  // Auto-shutdown
  ttl: number;  // Unix timestamp for auto-deletion
  
  // Metrics
  requestCount: number;
  bytesTransferred: number;
}
```

**Global Secondary Indexes**:
- **GSI1**: `clientId` (partition) + `status` (sort) - Find all active sessions for a client
- **GSI2**: `status` (partition) + `lastActivityAt` (sort) - Find sessions to shut down

**TTL Configuration**:
- TTL attribute: `ttl`
- Auto-delete after 24 hours of inactivity

### 2. Lambda@Edge Router Function

**Purpose**: Intercept CloudFront requests and route based on session state

**Trigger**: CloudFront Viewer Request

**Important Note**: Lambda@Edge functions have strict limitations (1MB deployment package, 128MB memory). Consider using CloudFront Functions for simple routing or AWS Lambda with API Gateway for complex logic.

```typescript
// lambda-edge-router.ts
export const handler: CloudFrontRequestHandler = async (event) => {
  const request = event.Records[0].cf.request;
  const uri = request.uri;
  
  // Extract session identifiers from request
  const { clientId, userId, threadId } = extractSessionInfo(request);
  
  if (!clientId) {
    // No session info - route to static S3
    return routeToS3(request);
  }
  
  // Check session state in DynamoDB
  const sessionId = `${clientId}#${userId}#${threadId}`;
  const session = await getSession(sessionId);
  
  // Routing decision tree
  switch (session?.status) {
    case 'active':
      // Route to Fargate via ALB
      await updateLastActivity(sessionId);
      return routeToFargate(request, session);
      
    case 'initializing':
      // Show loading page while Fargate starts
      return showLoadingPage(request);
      
    case 'draining':
      // Transitioning to static - route to S3
      return routeToS3(request);
      
    default:
      // No active session - check if should activate
      if (isEditRequest(request)) {
        await activateEditMode(sessionId);
        return showLoadingPage(request);
      }
      return routeToS3(request);
  }
};

function routeToFargate(request: CloudFrontRequest, session: EditSession) {
  // Modify request to route to ALB origin
  request.origin = {
    custom: {
      domainName: 'alb.webordinary.com',
      port: 443,
      protocol: 'https',
      path: `/preview/${session.clientId}`,
      customHeaders: {
        'x-session-id': [{ key: 'x-session-id', value: session.sessionId }],
        'x-container-ip': [{ key: 'x-container-ip', value: session.containerIp }]
      }
    }
  };
  return request;
}

function routeToS3(request: CloudFrontRequest) {
  // Default S3 origin for static content
  request.origin = {
    s3: {
      domainName: 'webordinary-sites.s3.amazonaws.com',
      path: `/production`,
      region: 'us-west-2'
    }
  };
  return request;
}
```

### 3. Session Lifecycle Management

#### A. Session Activation Flow

```typescript
// hermes/src/modules/edit-session/session-manager.ts
export class EditSessionManager {
  async activateEditMode(
    clientId: string,
    userId: string,
    threadId: string,
    instruction: string
  ): Promise<EditSession> {
    const sessionId = `${clientId}#${userId}#${threadId}`;
    
    // 1. Create/update session record
    const session = await this.ddb.put({
      TableName: 'webordinary-edit-sessions',
      Item: {
        sessionId,
        clientId,
        userId,
        threadId,
        status: 'initializing',
        branch: `thread-${threadId}`,
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 86400, // 24 hours
        requestCount: 0,
        bytesTransferred: 0,
        isDirty: false
      }
    });
    
    // 2. Trigger Fargate task startup
    const taskArn = await this.startFargateTask({
      clientId,
      userId,
      threadId,
      repoUrl: this.getRepoUrl(clientId)
    });
    
    // 3. Wait for container to be ready
    const containerIp = await this.waitForContainer(taskArn);
    
    // 4. Update session with container details
    await this.updateSession(sessionId, {
      status: 'active',
      taskArn,
      containerIp
    });
    
    // 5. Execute initial instruction
    await this.executeInstruction(containerIp, instruction);
    
    return session;
  }
  
  async deactivateEditMode(sessionId: string): Promise<void> {
    // 1. Update session status
    await this.updateSession(sessionId, {
      status: 'draining'
    });
    
    // 2. Commit and push any pending changes
    const session = await this.getSession(sessionId);
    if (session.isDirty) {
      await this.commitAndPush(session);
    }
    
    // 3. Trigger production build
    await this.triggerProductionBuild(session.branch);
    
    // 4. Stop Fargate task
    await this.stopFargateTask(session.taskArn);
    
    // 5. Mark session as inactive
    await this.updateSession(sessionId, {
      status: 'inactive',
      taskArn: null,
      containerIp: null
    });
  }
}
```

#### B. Auto-Shutdown Logic

```typescript
// fargate-container/src/services/activity-monitor.ts
export class ActivityMonitor {
  private lastActivity: Date = new Date();
  private shutdownTimer?: NodeJS.Timeout;
  
  constructor(
    private readonly sessionId: string,
    private readonly shutdownMinutes: number = 5
  ) {
    this.startMonitoring();
  }
  
  recordActivity(): void {
    this.lastActivity = new Date();
    this.resetShutdownTimer();
    
    // Update DynamoDB
    this.updateSessionActivity();
  }
  
  private startMonitoring(): void {
    this.resetShutdownTimer();
    
    // Check every minute
    setInterval(() => {
      const idleMinutes = (Date.now() - this.lastActivity.getTime()) / 60000;
      
      if (idleMinutes >= this.shutdownMinutes) {
        this.initiateShutdown();
      }
    }, 60000);
  }
  
  private async initiateShutdown(): Promise<void> {
    console.log(`Initiating shutdown after ${this.shutdownMinutes} minutes of inactivity`);
    
    // Update session status
    await this.sessionManager.deactivateEditMode(this.sessionId);
    
    // Graceful shutdown
    process.exit(0);
  }
}
```

### 4. CloudFront Behaviors Configuration

**Alternative Approach**: Since we already have an ALB from Task 00, we could simplify by:
1. Using Route 53 with weighted routing between CloudFront (S3) and ALB (Fargate)
2. Or having CloudFront always route to ALB, with ALB rules handling the routing logic
3. This avoids Lambda@Edge complexity and cost

```typescript
// cdk/lib/cloudfront-stack.ts
const distribution = new cloudfront.Distribution(this, 'Distribution', {
  defaultBehavior: {
    origin: s3Origin,
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    edgeLambdas: [
      {
        functionVersion: routerLambda.currentVersion,
        eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
      }
    ]
  },
  additionalBehaviors: {
    '/api/*': {
      origin: albOrigin,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: new cloudfront.OriginRequestPolicy(this, 'ApiPolicy', {
        headerBehavior: cloudfront.OriginRequestHeaderBehavior.all(),
        queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
        cookieBehavior: cloudfront.OriginRequestCookieBehavior.all()
      })
    },
    '/_astro/*': {
      origin: albOrigin,  // WebSocket support for HMR
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED
    }
  }
});
```

### 5. Fargate Task Startup Optimization

```typescript
// cdk/lib/fargate-stack.ts
export class OptimizedFargateService extends cdk.Construct {
  constructor(scope: Construct, id: string, props: OptimizedFargateProps) {
    super(scope, id);
    
    // Import existing resources from Task 00
    const alb = elbv2.ApplicationLoadBalancer.fromLoadBalancerArn(
      this,
      'ImportedALB',
      cdk.Fn.importValue('WebordinaryALBArn')
    );
    
    const ecrRepo = ecr.Repository.fromRepositoryArn(
      this,
      'ImportedECR',
      cdk.Fn.importValue('ClaudeCodeAstroRepoArn')
    );
    
    const fileSystemId = cdk.Fn.importValue('WorkspaceEFSId');
    const accessPointId = cdk.Fn.importValue('ClientAccessPointId');
    
    // Use Fargate Spot for cost savings
    const capacityProvider = new ecs.CapacityProvider(this, 'SpotCapacity', {
      capacityProviderName: 'FARGATE_SPOT',
    });
    
    // Task definition with startup optimization
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 2048,
      memoryLimitMiB: 4096,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.ARM64  // 20% cheaper
      }
    });
    
    // Container with health check for faster readiness
    const container = taskDef.addContainer('claude-code', {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:8080/health || exit 1'],
        interval: cdk.Duration.seconds(5),
        timeout: cdk.Duration.seconds(2),
        retries: 3,
        startPeriod: cdk.Duration.seconds(10)
      },
      startTimeout: cdk.Duration.seconds(30),
      stopTimeout: cdk.Duration.seconds(10)
    });
    
    // Service with fast scaling
    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 0,
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE_SPOT',
          weight: 2,
          base: 0
        },
        {
          capacityProvider: 'FARGATE',
          weight: 1,
          base: 0
        }
      ],
      enableExecuteCommand: true,  // For debugging
      enableLogging: true
    });
    
    // Application Auto Scaling
    const scaling = service.autoScaleTaskCount({
      minCapacity: 0,
      maxCapacity: 5
    });
    
    // Scale based on custom metric from DynamoDB
    scaling.scaleOnMetric('ActiveSessions', {
      metric: new cloudwatch.Metric({
        namespace: 'Webordinary/EditSessions',
        metricName: 'ActiveSessionCount',
        dimensionsMap: { ClientId: props.clientId }
      }),
      scalingSteps: [
        { upper: 0, change: -1 },  // Scale to 0 when no sessions
        { lower: 1, change: +1 },  // Scale up with sessions
        { lower: 3, change: +2 }   // Aggressive scaling for multiple sessions
      ],
      adjustmentType: autoscaling.AdjustmentType.CHANGE_IN_CAPACITY,
      cooldown: cdk.Duration.seconds(30)
    });
  }
}
```

### 6. Cost Optimization Features

#### A. Warm Pool Management
```typescript
// Keep one container warm during business hours
const warmPoolSchedule = new events.Rule(this, 'WarmPool', {
  schedule: events.Schedule.cron({
    minute: '0',
    hour: '9-17',
    weekDay: 'MON-FRI'
  })
});

warmPoolSchedule.addTarget(new targets.EcsTask({
  cluster,
  taskDefinition,
  taskCount: 1,
  platformVersion: ecs.FargatePlatformVersion.LATEST
}));
```

#### B. Session Bundling
```typescript
// Bundle multiple edit requests within 30s window
export class RequestBundler {
  private pendingRequests: Map<string, PendingRequest[]> = new Map();
  private bundleWindow = 30000; // 30 seconds
  
  async handleRequest(sessionId: string, request: EditRequest): Promise<void> {
    const existing = this.pendingRequests.get(sessionId) || [];
    existing.push(request);
    this.pendingRequests.set(sessionId, existing);
    
    // If first request, set timer
    if (existing.length === 1) {
      setTimeout(() => this.processBatch(sessionId), this.bundleWindow);
    }
  }
  
  private async processBatch(sessionId: string): Promise<void> {
    const requests = this.pendingRequests.get(sessionId) || [];
    this.pendingRequests.delete(sessionId);
    
    if (requests.length > 0) {
      // Start single container for batch
      await this.activateEditMode(sessionId, requests);
    }
  }
}
```

## API Endpoints

### Session Management API

```typescript
// POST /api/sessions/activate
{
  "clientId": "ameliastamps",
  "userId": "scott",
  "threadId": "task-123",
  "instruction": "Update homepage title"
}
// Response: { "sessionId": "...", "previewUrl": "..." }

// GET /api/sessions/{sessionId}/status
// Response: { "status": "active", "containerIp": "...", "lastActivity": "..." }

// POST /api/sessions/{sessionId}/keepalive
// Response: { "ttl": 1234567890 }

// POST /api/sessions/{sessionId}/deactivate
// Response: { "status": "draining", "productionBuildId": "..." }

// GET /api/sessions/client/{clientId}
// Response: [{ "sessionId": "...", "status": "...", "userId": "..." }]
```

## Monitoring & Observability

### CloudWatch Metrics

```typescript
// Custom metrics to track
const metrics = {
  'ActiveSessions': { unit: 'Count', value: activeSessions.length },
  'SessionActivationTime': { unit: 'Seconds', value: startupTime },
  'RoutingLatency': { unit: 'Milliseconds', value: routingTime },
  'CacheMissRate': { unit: 'Percent', value: missRate },
  'FargateTaskCount': { unit: 'Count', value: runningTasks },
  'CostPerSession': { unit: 'USD', value: sessionCost }
};
```

### CloudWatch Alarms

```typescript
new cloudwatch.Alarm(this, 'HighSessionCount', {
  metric: activeSessionMetric,
  threshold: 10,
  evaluationPeriods: 2,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
});

new cloudwatch.Alarm(this, 'SlowActivation', {
  metric: activationTimeMetric,
  threshold: 60, // seconds
  evaluationPeriods: 3
});
```

## Cost Analysis

### Per-Session Costs

| Component | Cost | Notes |
|-----------|------|-------|
| **Lambda@Edge** | $0.0001 | Per 10K requests |
| **DynamoDB** | $0.001 | Per session (read/write) |
| **Fargate Spot** | $0.80/hr | ARM64, 2vCPU/4GB |
| **Fargate On-Demand** | $1.20/hr | Fallback capacity |
| **Data Transfer** | $0.02/GB | ALB to Fargate |
| **CloudWatch Logs** | $0.01 | Per session |
| **Total per hour** | ~$0.85 | Spot pricing |

### Monthly Projections

| Usage Pattern | Hours/Month | Cost |
|---------------|-------------|------|
| Light (10hrs) | 10 | $8.50 |
| Medium (50hrs) | 50 | $42.50 |
| Heavy (100hrs) | 100 | $85.00 |
| Business Hours | 176 | $149.60 |

### Cost Optimization Achieved
- **90% reduction** vs always-on Fargate
- **70% reduction** using Fargate Spot
- **20% reduction** using ARM64 architecture
- **Zero cost** when no editing

## Implementation Phases

### Phase 1: Core Routing (Days 1-2)
- [ ] Create DynamoDB table with schema
- [ ] Implement Lambda@Edge router
- [ ] Basic session activation/deactivation
- [ ] CloudFront behavior configuration

### Phase 2: Session Management (Days 3-4)
- [ ] Session lifecycle manager in Hermes
- [ ] Fargate task startup optimization
- [ ] Activity monitoring in container
- [ ] Auto-shutdown implementation

### Phase 3: Optimization (Days 5-6)
- [ ] Implement Fargate Spot support
- [ ] Add warm pool scheduling
- [ ] Request bundling logic
- [ ] Cost tracking metrics

### Phase 4: Monitoring (Day 7)
- [ ] CloudWatch dashboard
- [ ] Custom metrics and alarms
- [ ] Session analytics
- [ ] Cost reporting

### Phase 5: Testing & Documentation (Days 8-9)
- [ ] End-to-end testing
- [ ] Load testing with multiple sessions
- [ ] Failover testing
- [ ] Documentation and runbooks

## Acceptance Criteria

1. ✅ Routing decisions made in < 50ms at edge
2. ✅ Session activation in < 30s (cold start)
3. ✅ Session resumption in < 2s (warm container)
4. ✅ Automatic shutdown after 5 minutes idle
5. ✅ Zero cost when no sessions active
6. ✅ Support for 10+ concurrent sessions
7. ✅ Graceful handling of Spot interruptions
8. ✅ Session state persisted across restarts
9. ✅ Production build triggered on deactivation
10. ✅ CloudWatch metrics for all operations

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| **Spot interruption** | Fallback to on-demand capacity |
| **DynamoDB throttling** | Auto-scaling and retry logic |
| **Lambda@Edge limits** | Efficient code, < 1MB package |
| **Cold start latency** | Warm pool during business hours |
| **Session data loss** | EFS persistence + git commits |
| **Cost overrun** | Billing alerts and hard limits |

## Dependencies

- **Task 00**: ALB and EFS infrastructure ✅ (DEPLOYED)
  - ALB: `webordinary-edit-alb-916355172.us-west-2.elb.amazonaws.com`
  - EFS: `fs-0ab7a5e03c0dc5bfd`
  - ECR: `942734823970.dkr.ecr.us-west-2.amazonaws.com/webordinary/claude-code-astro`
- **Task 01**: Docker container ✅ (COMPLETE - Image in ECR)
- **Task 02**: Fargate deployment ✅ (DEPLOYED - Ready for integration)
  - ECS Cluster: `webordinary-edit-cluster`
  - Service: `webordinary-edit-service` (scales 0-3 tasks)
  - Container URL: `https://webordinary-edit-alb-916355172.us-west-2.elb.amazonaws.com/api`
- **Task 03**: Claude Code SDK integration ✅ (COMPLETE in Hermes)
- **Task 04**: Git operations ✅ (COMPLETE in container)

## Testing Strategy

### Unit Tests
- Lambda@Edge routing logic
- Session state transitions
- Cost calculation accuracy

### Integration Tests
- End-to-end session lifecycle
- CloudFront to Fargate routing
- DynamoDB state consistency
- Auto-shutdown timing

### Load Tests
- 10 concurrent sessions
- 100 requests/second routing
- Spot capacity failover
- Scale-to-zero validation

### Chaos Tests
- Spot interruption handling
- Network partition recovery
- DynamoDB failure resilience
- Container crash recovery

## Success Metrics

| Metric | Target | Measure |
|--------|--------|---------|
| **Activation time** | < 30s | CloudWatch |
| **Routing latency** | < 50ms | Lambda@Edge logs |
| **Session uptime** | > 99% | DynamoDB records |
| **Cost per session** | < $1/hr | AWS Cost Explorer |
| **Auto-shutdown rate** | 100% | CloudWatch metrics |
| **User satisfaction** | > 90% | Response times |

## Rollback Plan

1. **Phase 1**: Disable Lambda@Edge, route all to S3
2. **Phase 2**: Keep Fargate always-on temporarily
3. **Phase 3**: Revert to on-demand pricing
4. **Phase 4**: Use basic CloudWatch only
5. **Complete**: Remove DynamoDB table, restore original CloudFront

## Estimated Timeline

- **Development**: 7 days
- **Testing**: 2 days
- **Documentation**: 1 day
- **Total**: 10 days

## Key Implementation Considerations

### Based on Completed Tasks:

1. **Simplify Container Role**:
   - Container just executes file operations (no AI/Claude needed)
   - Hermes handles all AI logic via Claude Code SDK
   - Container provides REST API for file/git/Astro operations

2. **Leverage Existing Infrastructure**:
   - Use existing ALB from Task 00
   - Mount existing EFS from Task 00
   - Pull container image from ECR (Task 01)
   - GitHub token already in Secrets Manager

3. **Routing Options to Consider**:
   - **Option A**: Lambda@Edge with DynamoDB (complex but flexible)
   - **Option B**: ALB path-based routing (simpler, less flexible)
   - **Option C**: Route 53 weighted routing (simplest for A/B testing)

4. **Cost Optimization Priority**:
   - Must complete Task 02 (Fargate) first
   - Focus on scale-to-zero capability
   - Consider Fargate Spot for additional savings

## 🚀 Ready for Implementation!

### All Prerequisites Met ✅
With Task 02 now complete, we have all the infrastructure needed to implement Task 05:

1. **Fargate Service**: Ready with auto-scaling (0-3 tasks)
2. **ALB with Routing**: Target groups and listener rules configured
3. **Container API**: Available at `https://webordinary-edit-alb-916355172.us-west-2.elb.amazonaws.com/api`
4. **EFS Persistence**: Mounted and ready for workspace storage
5. **Security Groups**: Properly restricted to AWS services only

### Implementation Path

#### Option A: Full Lambda@Edge Solution (Recommended for Production)
- **Pros**: Most flexible, true edge routing, lowest latency
- **Cons**: Complex, Lambda@Edge limitations, higher cost
- **Timeline**: 7-10 days

#### Option B: Simplified ALB-Based Solution (Recommended for MVP)
- **Pros**: Simpler, uses existing infrastructure, easier debugging
- **Cons**: Less flexible, all traffic hits ALB
- **Timeline**: 3-5 days
- **Implementation**: Path-based routing with session IDs

## Detailed Implementation Flow (Option B - Path-Based Routing)

### 1. Initial User Email → Fargate Initialization
```
User emails → SES → SQS → Hermes processes:
1. Router classifies as SIMPLE/COMPLEX
2. Hermes checks DynamoDB for existing session
3. No session found → Creates new session entry:
   - sessionId: uuid
   - userId: scott@ameliastamps.com  
   - status: "initializing"
   - createdAt: timestamp
4. Triggers Fargate scale-up via CloudWatch metric
5. Fargate container starts (30-60s cold start)
6. Container runs health check → marks session "active" in DynamoDB
7. Hermes executes Claude Code changes in container
8. Returns preview URL: edit.ameliastamps.com/session/{sessionId}
```

### 2. Routing During Active Session
```
ALB listener rules (priority order):
1. /api/* → Fargate API target group (port 8080)
2. /ws/* → Fargate WebSocket target group
3. /session/{sessionId}/* → Fargate Astro dev (port 4321)
4. /* (default) → S3 static origin via CloudFront
```

### 3. User Preview Requests During Edit
```
Browser → https://edit.ameliastamps.com/session/{sessionId} → ALB:
1. ALB routes to Fargate Astro dev server (port 4321)
2. WebSocket upgrade for HMR connections
3. Live preview with instant updates
4. Each request updates DynamoDB session TTL (30 min)
```

### 4. Session Scales to Zero After Idle
```
After 5 minutes of no requests:
1. CloudWatch detects no active sessions in DynamoDB
2. ECS Auto-scaling sets desired count to 0
3. Fargate task drains connections and stops
4. Session marked "expired" in DynamoDB (kept for history)
```

### 5. Later Visit (Should Hit S3)
```
User returns hours later:
- edit.ameliastamps.com → Serves static S3 content
- edit.ameliastamps.com/session/{oldId} → 404 or redirect to main
- ameliastamps.com → Always serves production static
```

### DynamoDB Schema for Option B
```typescript
{
  PK: "SESSION#{sessionId}",
  SK: "USER#{userId}",
  sessionId: string,
  userId: string,
  status: "initializing" | "active" | "expired",
  fargateTaskArn: string,
  lastActivity: timestamp,
  ttl: timestamp (30 min from lastActivity),
  editBranch: "thread-{uuid}",
  previewUrl: string  // Full URL with session path
}
```

### Why Path-Based Over Header-Based
- **Simpler**: No cookie/header management complexity
- **Shareable**: Users can share preview URLs
- **Clear semantics**: Session ID in URL makes state obvious
- **ALB native**: Direct path routing without Lambda validation
- **Future-proof**: Can add Lambda@Edge for advanced routing later

#### Option C: Hybrid Approach (Best of Both)
- Start with Option B for MVP
- Migrate to Option A when scale demands it
- **Timeline**: 3-5 days for MVP, +5 days for migration

### Immediate Next Steps

1. **Create DynamoDB Table** for session tracking
   ```bash
   aws dynamodb create-table \
     --table-name webordinary-edit-sessions \
     --attribute-definitions \
       AttributeName=sessionId,AttributeType=S \
     --key-schema \
       AttributeName=sessionId,KeyType=HASH \
     --billing-mode PAY_PER_REQUEST \
     --profile personal
   ```

2. **Update Hermes** to manage sessions
   - Add session creation on edit request
   - Implement session lifecycle (activate/deactivate)
   - Scale Fargate based on active sessions

3. **Configure Auto-Scaling Triggers**
   - CloudWatch metric for active sessions
   - Scale up when session created
   - Scale down after 5 minutes idle

4. **Add Session Headers** to ALB routing
   - `X-Edit-Session-Id` header for active sessions
   - Route to Fargate when present
   - Default to S3 (when available)

### Cost Impact Analysis

With current infrastructure:
- **Idle**: ~$0/month (Fargate at 0 tasks)
- **10 hrs/month**: ~$1.50 (as tested in Task 02)
- **50 hrs/month**: ~$7.50
- **Always on**: ~$65-70/month

Task 05 ensures we stay in the "10 hrs/month" range by:
- Auto-scaling to zero when not editing
- 5-minute idle shutdown
- Session-based activation

---

*Task 05 is now ready for implementation! All infrastructure dependencies are met. The recommended approach is to start with the simplified ALB-based solution (Option B) to get an MVP running quickly, then evolve to Lambda@Edge if needed for scale.*