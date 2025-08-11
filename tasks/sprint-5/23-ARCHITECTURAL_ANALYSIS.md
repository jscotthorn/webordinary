# Task 23: Architectural Analysis - Multi-Client Edit Environment Strategy

## Executive Summary

After reviewing Task 23 in the context of our existing architectural recommendations and current client data structure, this initiative represents a **significant architectural milestone** that requires careful planning across multiple dimensions. What initially appeared as a single task to serve `edit.amelia.webordinary.com` actually represents the foundation for our **multi-tenant client onboarding system**.

## Current State Analysis

### What We Have Today
1. **Hard-coded Client Configuration**: `ameliastamps` is hard-coded throughout the system
2. **Static Preview URLs**: `https://edit.ameliastamps.com/session/${sessionId}` is built statically 
3. **Single-Client Infrastructure**: ALB, DNS, certificates configured specifically for Amelia
4. **Session Data Model**: Already includes `clientId`, `previewUrl`, and session-to-container mapping

### Key Discovery: Existing Client-Aware Architecture
The good news is our data model is **already multi-client ready**:

```typescript
// EditSession interface already has client awareness
export interface EditSession {
  sessionId: string;
  userId: string;
  clientId: string;        // ✅ Already client-aware
  threadId: string;
  previewUrl?: string;     // ✅ Already supports dynamic URLs
  containerId?: string;    // ✅ Already container-aware
  // ...
}
```

## Architectural Decision Points

### 1. Client URL Strategy: Manual vs. Automated

**Current Approach (Manual - Recommended for MVP)**:
- DNS: Manual Route 53 configuration per client
- Certificates: Manual ACM certificate request per client domain
- ALB Rules: CDK-deployed per-client routing rules 

**Future Approach (Automated)**:
- API-driven client onboarding
- Automated DNS/certificate provisioning via AWS APIs
- Dynamic ALB rule creation

**Recommendation**: Start manual for first client, design interfaces for future automation.

### 2. Container-to-Client Routing Architecture

**Current Challenge**: How does ALB know which container serves which client?

**Three Architectural Approaches**:

#### Option A: Client-Specific Target Groups (Current Direction)
```typescript
// Each client gets dedicated target group
const ameliaTargetGroup = new ApplicationTargetGroup(this, 'AmeliaEditTargets');
const clientBTargetGroup = new ApplicationTargetGroup(this, 'ClientBEditTargets');

// ALB routes by hostname
new ApplicationListenerRule(this, 'AmeliaRule', {
  conditions: [ListenerCondition.hostHeaders(['edit.amelia.webordinary.com'])],
  action: ListenerAction.forward([ameliaTargetGroup])
});
```

#### Option B: Session-Based Lambda Routing (Recommended)
```typescript
// Single Lambda routes all edit.*.webordinary.com traffic
export async function routeEditRequest(event: ALBEvent): Promise<ALBResult> {
  const hostname = event.headers.host; // "edit.amelia.webordinary.com"
  const clientId = extractClientFromHostname(hostname); // "amelia" 
  const sessionId = extractSessionFromPath(event.path); // from /session/{id}/*
  
  // Look up which container serves this client+session
  const session = await findSessionByClientAndThread(clientId, sessionId);
  if (!session?.containerIp) {
    return await wakeContainerForClient(clientId, sessionId);
  }
  
  // Route to container
  return forwardToContainer(session.containerIp, event);
}
```

#### Option C: DNS-Based Routing
```typescript
// Each client gets separate ALB
edit.amelia.webordinary.com → ALB-amelia → Target-Group-Amelia
edit.clientb.webordinary.com → ALB-clientb → Target-Group-ClientB
```

**Recommendation**: Option B (Lambda Routing) provides the best balance of flexibility and cost efficiency.

### 3. Client Configuration Management

**Current Problem**: Client configuration is scattered and hard-coded.

**Proposed Solution**: Centralized Client Configuration Service

```typescript
// New client configuration interface
interface ClientConfig {
  clientId: string;
  domains: {
    production: string;    // "amelia.webordinary.com"
    edit: string;          // "edit.amelia.webordinary.com" 
    api: string;           // "api.amelia.webordinary.com"
  };
  repository: {
    url: string;
    branch: string;
    deployKey?: string;
  };
  infrastructure: {
    targetGroupArn: string;
    certificateArn: string;
    hostedZoneId: string;
  };
  settings: {
    containerSize: 'small' | 'medium' | 'large';
    idleTimeoutMinutes: number;
    maxConcurrentSessions: number;
  };
}

// Store in DynamoDB table: webordinary-client-configs
const AMELIA_CONFIG: ClientConfig = {
  clientId: 'amelia',
  domains: {
    production: 'amelia.webordinary.com',
    edit: 'edit.amelia.webordinary.com',
    api: 'api.amelia.webordinary.com'
  },
  repository: {
    url: 'https://github.com/webordinary/amelia-astro.git',
    branch: 'main'
  }
  // ...
};
```

## Recommended Implementation Strategy

### Phase 1: Foundation (Task 23A) - 1-2 Weeks
**Goal**: Get `edit.amelia.webordinary.com` working with existing architecture

**Scope**:
- Manual DNS setup for `edit.amelia.webordinary.com`
- Manual certificate request for `*.amelia.webordinary.com`
- Hard-coded ALB rules for Amelia (acceptable for MVP)
- Container serves Astro on port 8080 (simplify from current multi-port)
- Use existing session resumption logic from Task 21

**Deliverables**:
- Working `edit.amelia.webordinary.com` → Container → Astro
- Updated container to serve web interface
- ALB routing configuration
- Basic documentation

### Phase 2: Multi-Client Foundation (Task 23B) - 2-3 Weeks  
**Goal**: Create the architecture for multiple clients

**Scope**:
- Client Configuration Service (DynamoDB table + service layer)
- Lambda-based session routing for `edit.*.webordinary.com`
- Dynamic preview URL generation based on client config
- Container startup with client-specific repository cloning
- CDK stack parameterization for client resources

**Deliverables**:
- Client configuration management system
- Session routing Lambda
- Multi-client container startup logic
- CDK infrastructure updates

### Phase 3: Client Onboarding Process (Task 23C) - 2-3 Weeks
**Goal**: Streamlined process for adding new clients

**Scope**:
- Client onboarding CLI/API
- Automated certificate request workflow
- Automated DNS record creation (Route 53 API)
- Client-specific CDK stack deployment
- Monitoring and observability per client

**Deliverables**:
- Client onboarding automation
- Infrastructure provisioning workflows
- Client management dashboard
- Operational runbooks

## Technical Implementation Details

### Session Routing Lambda (Core Component)
```typescript
import { ALBEvent, ALBResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

export class SessionRouter {
  async routeEditRequest(event: ALBEvent): Promise<ALBResult> {
    const clientId = this.extractClientId(event.headers.host);
    const pathInfo = this.parseEditPath(event.path);
    
    switch (pathInfo.type) {
      case 'session':
        return await this.routeToSession(clientId, pathInfo.sessionId, event);
      case 'new':
        return await this.createNewSession(clientId, event);
      case 'static':
        return await this.serveStaticAssets(clientId, event);
      default:
        return this.notFound();
    }
  }
  
  private extractClientId(hostname: string): string {
    // "edit.amelia.webordinary.com" → "amelia"
    const match = hostname.match(/^edit\.([^.]+)\.webordinary\.com$/);
    return match?.[1] || 'unknown';
  }
  
  private async routeToSession(clientId: string, sessionId: string, event: ALBEvent) {
    const session = await this.sessionService.findSession(clientId, sessionId);
    
    if (!session?.containerIp) {
      // Wake up container or show loading page
      return await this.handleDormantSession(clientId, sessionId);
    }
    
    // Forward to container
    return this.forwardToContainer(session.containerIp, event);
  }
}
```

### Client Configuration Integration
```typescript
// Update EditSessionService to use client config
export class EditSessionService {
  async createSession(clientId: string, userId: string, instruction: string) {
    const clientConfig = await this.clientConfigService.getConfig(clientId);
    if (!clientConfig) {
      throw new Error(`Client ${clientId} not configured`);
    }
    
    // Use client-specific settings
    const session: EditSession = {
      // ... existing fields
      previewUrl: `https://${clientConfig.domains.edit}/session/${sessionId}`,
    };
    
    // Start container with client-specific repository
    const { taskArn, containerIp } = await this.fargateManager.startTask({
      sessionId,
      clientId,
      userId,
      threadId,
      repositoryUrl: clientConfig.repository.url,
      repositoryBranch: clientConfig.repository.branch
    });
  }
}
```

### Container Updates
```typescript
// Container startup with client awareness
export class ContainerStartup {
  async initialize() {
    const clientId = process.env.CLIENT_ID;
    const clientConfig = await this.loadClientConfig(clientId);
    
    // Clone client-specific repository  
    await this.cloneRepository(clientConfig.repository);
    
    // Start Astro with client-specific configuration
    await this.startAstroServer(clientConfig.astroConfig);
    
    // Start API server for session management
    await this.startApiServer();
  }
}
```

## Infrastructure as Code Strategy

### CDK Stack Architecture
```typescript
// Base stack for shared resources
export class WebordinaryBaseStack extends Stack {
  // Shared ALB, Lambda, etc.
}

// Per-client stack for client-specific resources
export class WebordinaryClientStack extends Stack {
  constructor(scope: Construct, id: string, props: ClientStackProps) {
    super(scope, id, props);
    
    // Client-specific target group
    const targetGroup = new ApplicationTargetGroup(this, 'EditTargetGroup', {
      // ... configuration
    });
    
    // Client-specific ALB rule
    new ApplicationListenerRule(this, 'EditRule', {
      listener: props.sharedAlb.listener,
      conditions: [
        ListenerCondition.hostHeaders([`edit.${props.clientId}.webordinary.com`])
      ],
      action: ListenerAction.weightedForward([
        { targetGroup, weight: 100 }
      ])
    });
  }
}
```

## Migration and Risk Management

### Backwards Compatibility
- Keep existing `edit.ameliastamps.com` working during transition
- Dual-mode operation during migration period
- Feature flags for new routing logic
- Gradual rollout per client

### Risk Mitigation
1. **Client Isolation**: Failure in one client doesn't affect others
2. **Resource Limits**: Per-client container and cost limits  
3. **Monitoring**: Client-specific dashboards and alerts
4. **Rollback Strategy**: Quick revert to single-client architecture
5. **Testing**: Comprehensive integration tests per client

## Cost and Resource Planning

### Infrastructure Costs per Client
- **DNS**: $0.50/month per hosted zone
- **Certificate**: Free (ACM)
- **ALB Rules**: No additional cost
- **Lambda**: ~$0.01/month for routing
- **DynamoDB**: ~$1/month for client config
- **Total Fixed**: ~$1.50/month per client

### Variable Costs (Usage-based)
- **Containers**: $0.05/hour when running  
- **Data Transfer**: ~$0.09/GB
- **SQS Messages**: $0.40/million messages

## Success Metrics and Monitoring

### Technical Metrics
- Container startup time per client
- Session routing latency
- Client isolation verification
- Resource utilization per client

### Business Metrics  
- Client onboarding time (target: <1 hour manual, <10 minutes automated)
- Multi-tenant stability (99.9% uptime per client)
- Cost per client (target: <$50/month including usage)

## Conclusion and Recommendations

**Task 23 should be split into 3 phases** to manage complexity and risk:

1. **23A (MVP)**: Get Amelia working with minimal changes
2. **23B (Foundation)**: Build multi-client architecture  
3. **23C (Scale)**: Automate client onboarding

This approach allows us to:
- ✅ Deliver immediate value for Amelia (Phase 1)
- ✅ Build scalable architecture (Phase 2)  
- ✅ Create competitive advantage through easy onboarding (Phase 3)
- ✅ Maintain system stability throughout migration
- ✅ Validate architecture with real client before scaling

The existing session resumption logic (Task 21) and integration testing framework (Task 22) provide a solid foundation for this multi-client evolution. The key insight is that our data model is already client-aware - we just need to operationalize that awareness in the infrastructure and routing layers.

**Immediate Next Step**: Begin Phase 1 (Task 23A) to get `edit.amelia.webordinary.com` working, while designing the client configuration interfaces needed for Phase 2.