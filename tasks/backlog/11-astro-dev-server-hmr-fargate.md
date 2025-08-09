# Task 08: Implement Astro Dev Server with HMR in Fargate

## Overview
Enable Hot Module Replacement (HMR) and live development features for Astro sites within the Fargate container environment, providing real-time editing capabilities with WebSocket support via Application Load Balancer.

## Background
- Sprint 1 established the Claude Code container with basic Astro support
- Task 05 implemented intelligent routing with ALB listener rules
- Current setup supports static builds but lacks live development features
- WebSocket support needed for HMR functionality

## Requirements

### Core Functionality
1. **Astro Dev Server Integration**
   - Run `astro dev` within Fargate container
   - Configure proper port exposure (4321 default)
   - Handle WebSocket connections for HMR
   - Support Vite's development middleware

2. **ALB WebSocket Configuration**
   - Enable sticky sessions for WebSocket connections
   - Configure health checks compatible with dev server
   - Proper timeout settings for long-lived connections
   - Target group attributes for WebSocket support

3. **Container Updates**
   - Modify Dockerfile for dev server support
   - Configure proper environment variables
   - Handle both dev and production modes
   - Ensure proper file watching capabilities

4. **Session-Based Routing**
   - Leverage existing `/session/{sessionId}` routing from Task 05
   - Ensure WebSocket upgrade works through ALB
   - Maintain session affinity for HMR connections

## Technical Implementation

### 1. ALB Configuration Updates
```typescript
// In fargate-stack.ts
const targetGroup = new elbv2.ApplicationTargetGroup(this, 'AstroDevTargetGroup', {
  vpc,
  port: 4321,
  protocol: elbv2.ApplicationProtocol.HTTP,
  targetType: elbv2.TargetType.IP,
  healthCheck: {
    path: '/',
    interval: cdk.Duration.seconds(30),
    timeout: cdk.Duration.seconds(10),
    healthyThresholdCount: 2,
    unhealthyThresholdCount: 3,
  },
  stickinessCookieDuration: cdk.Duration.hours(1),
  // Enable WebSocket support
  targetGroupAttributes: {
    'stickiness.enabled': 'true',
    'stickiness.type': 'lb_cookie',
  },
});

// WebSocket-specific listener rule
listener.addRule('WebSocketRule', {
  priority: 25,
  conditions: [
    elbv2.ListenerCondition.pathPatterns(['/_hmr/*', '/vite-hmr/*']),
  ],
  action: elbv2.ListenerAction.forward([targetGroup]),
});
```

### 2. Dockerfile Modifications
```dockerfile
# Add development dependencies
RUN npm install -g @astrojs/cli vite

# Expose both API and dev server ports
EXPOSE 8080 4321

# Environment-based startup
CMD if [ "$NODE_ENV" = "development" ]; then \
      npm run dev & npm run api; \
    else \
      npm run build && npm run api; \
    fi
```

### 3. Astro Configuration
```javascript
// astro.config.mjs updates
export default defineConfig({
  server: {
    port: 4321,
    host: true, // Listen on all network interfaces
  },
  vite: {
    server: {
      hmr: {
        port: 4321,
        protocol: 'wss',
        clientPort: 443, // ALB SSL port
        path: '/_hmr',
      },
      watch: {
        usePolling: true, // Required for Docker
        interval: 1000,
      },
    },
  },
});
```

### 4. Container API Updates
```typescript
// In thread-manager.ts
class ThreadManager {
  async startDevServer(threadId: string): Promise<void> {
    const projectPath = this.getProjectPath(threadId);
    
    // Kill any existing dev server
    await this.stopDevServer(threadId);
    
    // Start Astro dev server
    const devProcess = spawn('npm', ['run', 'dev'], {
      cwd: projectPath,
      env: {
        ...process.env,
        PORT: '4321',
        HOST: '0.0.0.0',
        NODE_ENV: 'development',
      },
    });
    
    this.devServers.set(threadId, devProcess);
    
    // Wait for server to be ready
    await this.waitForDevServer(4321);
  }
  
  async stopDevServer(threadId: string): Promise<void> {
    const process = this.devServers.get(threadId);
    if (process) {
      process.kill('SIGTERM');
      this.devServers.delete(threadId);
    }
  }
}
```

## Implementation Steps

### Phase 1: ALB WebSocket Support
1. Update `fargate-stack.ts` with WebSocket-enabled target groups
2. Configure sticky sessions for WebSocket affinity
3. Add listener rules for HMR paths
4. Test WebSocket upgrade through ALB

### Phase 2: Container Development Mode
1. Update Dockerfile with dev server dependencies
2. Implement environment-based startup logic
3. Configure proper port exposure
4. Test container in development mode locally

### Phase 3: Astro HMR Configuration
1. Update `astro.config.mjs` for containerized HMR
2. Configure Vite for Docker file watching
3. Set proper WebSocket paths and protocols
4. Test HMR functionality end-to-end

### Phase 4: Integration Testing
1. Deploy updated container to ECR
2. Test session-based routing with dev server
3. Verify HMR works through ALB
4. Ensure proper cleanup on session end

## Success Criteria

### Functional Requirements
- [ ] Astro dev server runs successfully in Fargate
- [ ] HMR updates reflect immediately in browser
- [ ] WebSocket connections maintain through ALB
- [ ] File changes trigger proper hot reloads
- [ ] Session routing works with dev server

### Performance Requirements
- [ ] HMR updates complete within 500ms
- [ ] WebSocket connections remain stable
- [ ] No memory leaks during long sessions
- [ ] Proper cleanup on container shutdown

### Security Requirements
- [ ] Dev server only accessible via session routes
- [ ] No exposure of internal container ports
- [ ] Proper authentication for WebSocket upgrade
- [ ] Environment variables properly secured

## Testing Plan

### Local Testing
```bash
# Build and run container locally
docker build -t webordinary/claude-code-astro:dev .
docker run -p 4321:4321 -p 8080:8080 \
  -e NODE_ENV=development \
  webordinary/claude-code-astro:dev

# Test HMR
curl http://localhost:4321
# Make file changes and verify hot reload
```

### Integration Testing
```bash
# Deploy to Fargate
./build-and-push.sh dev
aws ecs update-service --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --force-new-deployment

# Test through ALB
curl https://edit.ameliastamps.com/session/test-session/
# Verify WebSocket upgrade in browser dev tools
```

## Rollback Plan
1. Revert to previous container image in ECR
2. Update ECS service to use previous task definition
3. Remove WebSocket-specific ALB rules if needed
4. Document any issues for future retry

## Dependencies
- Task 05 completion (session-based routing)
- ALB with SSL/TLS configured
- Fargate container with proper IAM roles
- EFS for persistent file storage

## Estimated Timeline
- ALB Configuration: 2 hours
- Container Updates: 3 hours
- Astro/Vite Setup: 2 hours
- Integration Testing: 2 hours
- **Total: 1-2 days**

## Notes
- Consider using AWS App Runner for simpler WebSocket handling in future
- May need to adjust ALB idle timeout for long-lived connections
- Monitor CloudWatch logs for WebSocket connection issues
- Document any Vite-specific configuration quirks for future reference