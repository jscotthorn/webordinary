# Task 24: Multi-Client Foundation Architecture

## Objective
Build the foundational architecture to support multiple clients by creating client configuration management, dynamic session routing, and generalized container startup processes. This transforms our hard-coded Amelia-specific solution into a scalable multi-tenant platform.

## Background
Task 23 successfully delivered a working web interface for `edit.amelia.webordinary.com` using hard-coded configuration. This task removes those hard-coded assumptions and creates the infrastructure needed to support multiple clients like Amelia, with dynamic routing and configuration management.

## Requirements

### Client Configuration System
1. **Client Configuration Service**
   - DynamoDB table: `webordinary-client-configs`
   - TypeScript interface for client configuration
   - Service layer for client configuration CRUD operations
   - Validation and schema enforcement

2. **Client Configuration Schema**
   ```typescript
   interface ClientConfig {
     clientId: string;
     domains: {
       production: string;    // "amelia.webordinary.com"
       edit: string;          // "edit.amelia.webordinary.com"
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
   ```

### Dynamic Session Routing
3. **Session Router Lambda**
   - Extract clientId from hostname (`edit.{clientId}.webordinary.com`)
   - Look up client configuration from DynamoDB
   - Route to appropriate container based on session mapping
   - Handle container wake-up with client context

4. **ALB Integration**
   - Single ALB listener rule for `edit.*.webordinary.com` pattern
   - Route all edit traffic through Session Router Lambda
   - Remove hard-coded per-client ALB rules

### Container Generalization
5. **Client-Aware Container Startup**
   - Accept clientId as environment variable
   - Load client configuration on startup
   - Clone client-specific repository dynamically  
   - Build and serve client-specific Astro application

6. **Dynamic Preview URL Generation**
   - Update EditSessionService to use client configuration
   - Generate preview URLs based on client domains
   - Update session resumption to work with any client

## Implementation Plan

### Phase 1: Client Configuration Infrastructure (Week 1)

#### Day 1-2: Client Configuration Service
```typescript
// New service: hermes/src/modules/client-config/
export class ClientConfigService {
  async getConfig(clientId: string): Promise<ClientConfig | null> {
    const result = await this.dynamoClient.send(
      new GetItemCommand({
        TableName: 'webordinary-client-configs',
        Key: { clientId: { S: clientId } }
      })
    );
    return result.Item ? this.unmarshallConfig(result.Item) : null;
  }

  async createConfig(config: ClientConfig): Promise<void> {
    await this.dynamoClient.send(
      new PutItemCommand({
        TableName: 'webordinary-client-configs',
        Item: this.marshallConfig(config)
      })
    );
  }
}
```

#### Day 3-4: CDK Infrastructure Updates
```typescript
// Update hephaestus CDK stack
export class ClientConfigStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // Client configuration table
    const clientConfigTable = new Table(this, 'ClientConfigs', {
      tableName: 'webordinary-client-configs',
      partitionKey: { name: 'clientId', type: AttributeType.STRING },
      billing: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED
    });

    // Session router Lambda
    const sessionRouter = new Function(this, 'SessionRouter', {
      runtime: Runtime.NODEJS_18_X,
      handler: 'session-router.handler',
      code: Code.fromAsset('./lambdas/session-router'),
      environment: {
        CLIENT_CONFIG_TABLE: clientConfigTable.tableName
      }
    });

    clientConfigTable.grantReadData(sessionRouter);
  }
}
```

#### Day 5: Initial Data Migration
```typescript
// Migrate Amelia configuration
const AMELIA_CONFIG: ClientConfig = {
  clientId: 'amelia',
  domains: {
    production: 'amelia.webordinary.com',
    edit: 'edit.amelia.webordinary.com'
  },
  repository: {
    url: 'https://github.com/webordinary/amelia-astro.git',
    branch: 'main'
  },
  infrastructure: {
    targetGroupArn: 'arn:aws:elasticloadbalancing:us-west-2:942734823970:targetgroup/amelia-edit/abc123',
    certificateArn: 'arn:aws:acm:us-west-2:942734823970:certificate/amelia-cert',
    hostedZoneId: 'Z123456789'
  },
  settings: {
    containerSize: 'medium',
    idleTimeoutMinutes: 20,
    maxConcurrentSessions: 5
  }
};
```

### Phase 2: Session Router Lambda (Week 2)

#### Day 1-3: Core Routing Logic
```typescript
// lambdas/session-router/src/handler.ts
export async function handler(event: ALBEvent): Promise<ALBResult> {
  const clientId = extractClientId(event.headers.host);
  const pathInfo = parseEditPath(event.path);

  // Load client configuration
  const clientConfig = await clientConfigService.getConfig(clientId);
  if (!clientConfig) {
    return notFound(`Client ${clientId} not configured`);
  }

  switch (pathInfo.type) {
    case 'session':
      return await routeToSession(clientId, pathInfo.sessionId, event);
    case 'new':
      return await createNewSession(clientId, event);
    case 'static':
      return await serveStaticAssets(clientId, event);
    default:
      return notFound();
  }
}

function extractClientId(hostname: string): string {
  // "edit.amelia.webordinary.com" → "amelia"
  const match = hostname.match(/^edit\.([^.]+)\.webordinary\.com$/);
  return match?.[1] || 'unknown';
}
```

#### Day 4-5: Container Integration
```typescript
async function routeToSession(clientId: string, sessionId: string, event: ALBEvent) {
  const session = await sessionService.findSession(clientId, sessionId);
  
  if (!session?.containerIp) {
    // Wake container with client context
    return await wakeContainerForClient(clientId, sessionId, event);
  }
  
  // Forward to running container
  return forwardToContainer(session.containerIp, event);
}

async function wakeContainerForClient(clientId: string, sessionId: string, event: ALBEvent) {
  // Show loading page while container starts
  const loadingHtml = generateLoadingPage(clientId, sessionId);
  
  // Trigger container wake (async)
  sessionService.wakeContainer(clientId, sessionId);
  
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: loadingHtml
  };
}
```

### Phase 3: Container Generalization (Week 3)

#### Day 1-2: Client-Aware Container Startup
```typescript
// claude-code-container/src/client-manager.ts
export class ClientManager {
  private clientConfig: ClientConfig;

  async initialize() {
    const clientId = process.env.CLIENT_ID;
    if (!clientId) {
      throw new Error('CLIENT_ID environment variable required');
    }

    // Load client configuration
    this.clientConfig = await this.loadClientConfig(clientId);
    
    // Clone client-specific repository
    await this.setupClientWorkspace();
    
    // Start web server with client context
    await this.startWebServer();
  }

  private async setupClientWorkspace() {
    const { url, branch } = this.clientConfig.repository;
    
    // Clone repository
    await this.gitService.clone(url, branch, './workspace');
    
    // Install dependencies
    await this.executeCommand('npm install', { cwd: './workspace' });
    
    // Build Astro application
    await this.executeCommand('npm run build', { cwd: './workspace' });
  }

  private async startWebServer() {
    const app = express();
    
    // Serve client-specific Astro build
    app.use(express.static('./workspace/dist/client'));
    
    // Handle client-specific routing
    app.get('/session/:sessionId/*', (req, res) => {
      res.sendFile('./workspace/dist/client/index.html', { root: process.cwd() });
    });
    
    // Keep existing API routes
    app.use('/api', this.apiRoutes);
    
    app.listen(8080);
  }
}
```

#### Day 3-4: Dynamic Preview URL Generation
```typescript
// Update hermes EditSessionService
export class EditSessionService {
  async createSession(clientId: string, userId: string, instruction: string) {
    // Load client configuration
    const clientConfig = await this.clientConfigService.getConfig(clientId);
    if (!clientConfig) {
      throw new Error(`Client ${clientId} not configured`);
    }

    const session: EditSession = {
      sessionId,
      userId,
      clientId,
      threadId,
      status: 'initializing',
      // Dynamic preview URL from client config
      previewUrl: `https://${clientConfig.domains.edit}/session/${sessionId}`,
      lastActivity: now,
      ttl,
      editBranch: threadId,
      createdAt: new Date(now).toISOString()
    };

    // Start container with client configuration
    const { taskArn, containerIp } = await this.fargateManager.startTask({
      sessionId,
      clientId,
      userId,
      threadId,
      clientConfig // Pass full config to container
    });

    // ... rest of session creation
  }
}
```

#### Day 5: Testing and Integration
- Update integration tests from Task 22 to work with multiple clients
- Test session routing for different client domains
- Validate container startup with different repositories
- End-to-end testing with Amelia configuration

## Technical Architecture

### Request Flow (Updated)
```
User → edit.{client}.webordinary.com 
     → ALB (single wildcard rule)
     → Session Router Lambda
     │  ├── Extract clientId from hostname
     │  ├── Load client configuration  
     │  └── Route based on session state
     → Container:8080 (client-specific)
     → Client's Astro Application
```

### Data Model Updates
```typescript
// Updated EditSession interface
interface EditSession {
  // ... existing fields
  clientId: string;              // Now actively used for routing
  previewUrl: string;            // Dynamic based on client config
}

// New client configuration table
interface ClientConfigItem {
  clientId: string;              // Partition key
  config: ClientConfig;          // Full configuration object
  createdAt: string;
  updatedAt: string;
}
```

## Testing Strategy

### Unit Tests
- ClientConfigService CRUD operations
- Session router client ID extraction
- Container client configuration loading
- Preview URL generation

### Integration Tests
- Multi-client session routing
- Container startup with different repositories
- Session resumption across clients
- Client configuration validation

### End-to-End Tests  
- Complete flow for multiple test clients
- Container isolation between clients
- Session wake-up with client context

## Success Criteria
- [ ] Client configuration system operational
- [ ] Session router handles multiple client domains
- [ ] Containers start with client-specific repositories
- [ ] Preview URLs generate dynamically per client
- [ ] Amelia continues working without changes
- [ ] Foundation ready for adding second client
- [ ] No performance degradation from generalization
- [ ] Comprehensive test coverage for multi-client scenarios

## Dependencies
- **Task 23**: Working Amelia web interface (prerequisite)
- **Infrastructure**: CDK deployment pipeline
- **Testing**: Task 22 integration test framework

## Risks and Mitigation
1. **Breaking Changes**: Maintain backwards compatibility for Amelia
2. **Performance**: Monitor Lambda cold starts and caching
3. **Complexity**: Keep configuration schema simple and validated
4. **Testing**: Ensure thorough coverage of edge cases
5. **Data Migration**: Careful migration of existing Amelia data

## Out of Scope (Future Tasks)
- Automated client onboarding → **Task 26**
- Advanced client features → **Task 25**
- Multi-region support → Future sprint
- Advanced monitoring per client → **Task 25**

## Deliverables
- Client configuration service and DynamoDB table
- Session router Lambda with multi-client support
- Client-aware container startup process
- Updated EditSessionService with dynamic configuration
- Comprehensive test suite for multi-client scenarios
- Migration guide from single-client to multi-client architecture
- Documentation for adding new clients manually