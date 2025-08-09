# Task 20: Update ALB Routing for Session-Based Preview URLs

## Objective
Update the Application Load Balancer routing to support the new session-based preview URL pattern `/session/{chatThreadId}/*` routing directly to Astro dev servers.

## Requirements

### URL Structure
1. **Preview URL Pattern**:
   - Format: `https://edit.{clientId}.webordinary.com/session/{chatThreadId}/*`
   - Example: `https://edit.ameliastamps.webordinary.com/session/thread-abc123/`
   - Routes to container's Astro dev server on port 4321

2. **Container Discovery**:
   - ALB needs to route to correct container based on session
   - Use Lambda@Edge or path-based routing
   - Handle container not found gracefully

3. **WebSocket Support**:
   - Maintain HMR WebSocket connections
   - Route `/_astro/*` WebSocket traffic correctly
   - Sticky sessions for WebSocket

## Implementation Approach

### Option 1: Path-Based Routing with Target Group per Container (Simple)

```typescript
// hephaestus/lib/alb-routing-stack.ts
export class AlbRoutingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AlbRoutingProps) {
    super(scope, id, props);
    
    // Create target group per container dynamically
    const createTargetGroupForContainer = (
      containerId: string,
      containerIp: string
    ) => {
      const targetGroup = new elbv2.ApplicationTargetGroup(
        this,
        `TG-${containerId}`,
        {
          vpc: props.vpc,
          port: 4321,
          protocol: elbv2.ApplicationProtocol.HTTP,
          targetType: elbv2.TargetType.IP,
          targets: [new elbv2.IpTarget(containerIp, 4321)],
          healthCheck: {
            path: '/',
            interval: cdk.Duration.seconds(30),
            timeout: cdk.Duration.seconds(5)
          },
          deregistrationDelay: cdk.Duration.seconds(30)
        }
      );
      
      return targetGroup;
    };
    
    // Lambda to manage dynamic routing rules
    const routingManager = new lambda.Function(this, 'RoutingManager', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          // This Lambda updates ALB rules based on DynamoDB session mappings
          // Called by DynamoDB streams when sessions are created/deleted
          const { sessionId, containerId, containerIp, action } = event;
          
          if (action === 'CREATE') {
            // Create new listener rule for this session
            await createListenerRule(sessionId, containerId, containerIp);
          } else if (action === 'DELETE') {
            // Remove listener rule for this session
            await deleteListenerRule(sessionId);
          }
        };
      `)
    });
  }
}
```

### Option 2: Lambda-Based Request Routing (Flexible)

```typescript
// hephaestus/lambdas/session-router/index.ts
import { ALBEvent, ALBResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

const dynamodb = new DynamoDBClient({ region: 'us-west-2' });

export const handler = async (event: ALBEvent): Promise<ALBResult> => {
  // Extract session ID from path
  const path = event.path;
  const match = path.match(/^\/session\/([^\/]+)/);
  
  if (!match) {
    return {
      statusCode: 404,
      body: 'Session not found in URL'
    };
  }
  
  const chatThreadId = match[1];
  const clientId = extractClientFromHost(event.headers.host);
  const sessionId = `${clientId}-${chatThreadId}`;
  
  // Look up session in DynamoDB
  const session = await dynamodb.send(new GetItemCommand({
    TableName: 'webordinary-edit-sessions',
    Key: { sessionId: { S: sessionId } }
  }));
  
  if (!session.Item) {
    return {
      statusCode: 404,
      body: `
        <html>
          <body>
            <h1>Session Not Found</h1>
            <p>The edit session ${chatThreadId} is not active.</p>
            <p>Please start a new session by sending an email.</p>
          </body>
        </html>
      `,
      headers: {
        'Content-Type': 'text/html'
      }
    };
  }
  
  // Get container info
  const containerId = session.Item.containerId.S;
  const container = await dynamodb.send(new GetItemCommand({
    TableName: 'webordinary-containers',
    Key: { containerId: { S: containerId } }
  }));
  
  if (!container.Item || !container.Item.containerIp) {
    return {
      statusCode: 503,
      body: 'Container starting, please wait...',
      headers: {
        'Retry-After': '5'
      }
    };
  }
  
  // Forward request to container
  const containerIp = container.Item.containerIp.S;
  const targetUrl = `http://${containerIp}:4321${path.replace(/^\/session\/[^\/]+/, '')}`;
  
  try {
    const response = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: event.headers,
      body: event.body
    });
    
    const body = await response.text();
    
    return {
      statusCode: response.status,
      body,
      headers: Object.fromEntries(response.headers.entries()),
      isBase64Encoded: false
    };
  } catch (error) {
    return {
      statusCode: 502,
      body: 'Failed to connect to edit container'
    };
  }
};

function extractClientFromHost(host: string): string {
  // edit.ameliastamps.webordinary.com -> ameliastamps
  const match = host.match(/^edit\.([^.]+)\./);
  return match ? match[1] : 'default';
}
```

### CDK ALB Configuration

```typescript
// hephaestus/lib/alb-stack.ts
export class AlbStack extends cdk.Stack {
  setupRouting() {
    // Create Lambda target for session routing
    const sessionRouter = new targets.LambdaTarget(this.routingLambda);
    
    // Add listener rule for session paths
    this.httpsListener.addRules('SessionRouting', {
      priority: 10,
      conditions: [
        elbv2.ListenerCondition.hostHeaders(['edit.*.webordinary.com']),
        elbv2.ListenerCondition.pathPatterns(['/session/*'])
      ],
      actions: [
        elbv2.ListenerAction.forward([sessionRouter])
      ]
    });
    
    // WebSocket routing for HMR
    this.httpsListener.addRules('WebSocketRouting', {
      priority: 11,
      conditions: [
        elbv2.ListenerCondition.hostHeaders(['edit.*.webordinary.com']),
        elbv2.ListenerCondition.pathPatterns(['/_astro/*'])
      ],
      actions: [
        elbv2.ListenerAction.forward([sessionRouter])
      ]
    });
    
    // Default fallback
    this.httpsListener.addRules('DefaultRouting', {
      priority: 100,
      conditions: [
        elbv2.ListenerCondition.hostHeaders(['edit.*.webordinary.com'])
      ],
      actions: [
        elbv2.ListenerAction.fixedResponse(404, {
          contentType: 'text/html',
          messageBody: `
            <html>
              <body>
                <h1>No Active Session</h1>
                <p>Please start an edit session by sending an email.</p>
              </body>
            </html>
          `
        })
      ]
    });
  }
}
```

### Session-Aware Health Checks

```typescript
// Container registers itself with ALB
export class ContainerRegistration {
  async registerWithAlb() {
    const metadata = await this.getEcsMetadata();
    const containerIp = metadata.Networks[0].IPv4Addresses[0];
    
    // Register IP with target group
    await this.elbv2.send(new RegisterTargetsCommand({
      TargetGroupArn: process.env.TARGET_GROUP_ARN,
      Targets: [{
        Id: containerIp,
        Port: 4321
      }]
    }));
    
    // Update container record with IP
    await this.dynamodb.send(new UpdateItemCommand({
      TableName: 'webordinary-containers',
      Key: { containerId: { S: process.env.CONTAINER_ID } },
      UpdateExpression: 'SET containerIp = :ip, targetGroupArn = :tg',
      ExpressionAttributeValues: {
        ':ip': { S: containerIp },
        ':tg': { S: process.env.TARGET_GROUP_ARN }
      }
    }));
  }
  
  async deregisterFromAlb() {
    const metadata = await this.getEcsMetadata();
    const containerIp = metadata.Networks[0].IPv4Addresses[0];
    
    await this.elbv2.send(new DeregisterTargetsCommand({
      TargetGroupArn: process.env.TARGET_GROUP_ARN,
      Targets: [{
        Id: containerIp,
        Port: 4321
      }]
    }));
  }
}
```

### WebSocket Support

```nginx
# ALB WebSocket configuration
location /_astro {
    proxy_pass http://container:4321;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # Sticky sessions for WebSocket
    proxy_set_header X-Session-Affinity $cookie_session_affinity;
    proxy_read_timeout 86400;
}
```

## Success Criteria
- [ ] Preview URLs route to correct container
- [ ] WebSocket/HMR works properly
- [ ] 404 shown for invalid sessions
- [ ] Container discovery works
- [ ] Health checks function correctly
- [ ] Graceful handling of container restarts

## Testing
- Test preview URL routing
- Verify WebSocket connections
- Test with multiple concurrent sessions
- Verify container failover
- Test session expiry handling