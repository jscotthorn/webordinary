# Task 23: Astro Edit Environment Deployment - MVP for Amelia

## Objective
Get `edit.amelia.webordinary.com` working as a functional web-based editing environment for our first client, serving the Astro application from Claude Code containers with minimal architectural changes. This is Phase 1 of our multi-client platform - focused on proving the concept with Amelia before generalizing.

## Background
The session resumption functionality (Task 21) and integration testing (Task 22) provide the foundation for container lifecycle management. This task adds the web interface layer, allowing users to access their editing environment through `edit.amelia.webordinary.com`. We'll use a pragmatic approach with some hard-coded Amelia-specific configuration, while designing interfaces for future generalization (Tasks 24-26).

## Requirements (MVP Scope)

### Infrastructure Setup
1. **Manual DNS Configuration**
   - Configure Route 53 DNS record for `edit.amelia.webordinary.com` → ALB
   - Request ACM certificate for `*.amelia.webordinary.com` 
   - Validate certificate covers edit subdomain

2. **ALB Configuration**
   - Add listener rule for `edit.amelia.webordinary.com` hostname
   - Route to existing Amelia target group (hard-coded for MVP)
   - Configure health checks for port 8080

### Container Web Server
3. **Simplified Port Architecture**
   - Serve Astro application on port 8080 (same as API)
   - Remove multi-port complexity (4321, 4322) for now
   - Single HTTP server handles both web UI and API endpoints

4. **Container Integration**
   - Update Claude Code container to serve web interface
   - Integrate Astro build/serve into container startup
   - Maintain existing API endpoints for session management
   - Use existing session resumption logic from Task 21

### Session Integration (Minimal)
5. **Basic Session Routing**
   - Use existing session-to-container mapping from Task 21
   - Hard-code "amelia" as clientId for MVP
   - Route `/session/{sessionId}/*` to appropriate container
   - Maintain existing container wake-up behavior

6. **Simple Authentication**
   - Basic session validation (no complex auth for MVP)
   - Use existing session management from EditSessionService
   - Protect against direct container access

## Implementation Plan (MVP Focus)

### Step 1: Infrastructure Setup (1-2 days)
1. **DNS Configuration**
   ```bash
   # Manual Route 53 DNS record creation
   aws route53 change-resource-record-sets --hosted-zone-id Z123 --change-batch '{
     "Changes": [{
       "Action": "CREATE",
       "ResourceRecordSet": {
         "Name": "edit.amelia.webordinary.com",
         "Type": "CNAME", 
         "TTL": 300,
         "ResourceRecords": [{"Value": "webordinary-edit-alb-916355172.us-west-2.elb.amazonaws.com"}]
       }
     }]
   }'
   ```

2. **Certificate Request**
   ```bash
   # Request ACM certificate for *.amelia.webordinary.com
   aws acm request-certificate \
     --domain-name "*.amelia.webordinary.com" \
     --domain-name "amelia.webordinary.com" \
     --validation-method DNS
   ```

3. **ALB Listener Rule (CDK)**
   ```typescript
   // Add to existing CDK stack
   new ApplicationListenerRule(this, 'EditAmeliaRule', {
     listener: this.albListener,
     priority: 50,
     conditions: [
       ListenerCondition.hostHeaders(['edit.amelia.webordinary.com'])
     ],
     action: ListenerAction.forward([this.ameliaTargetGroup]) // Use existing
   });
   ```

### Step 2: Container Web Server (3-4 days)
4. **Simplified Container Architecture**
   ```typescript
   // Update claude-code-container/src/app.ts
   const express = require('express');
   const path = require('path');
   
   // Serve Astro static files
   app.use('/static', express.static('./web/dist/client'));
   
   // Serve Astro app for web routes
   app.get('/session/:sessionId/*', (req, res) => {
     res.sendFile(path.join(__dirname, './web/dist/client/index.html'));
   });
   
   // Keep existing API routes
   app.use('/api', existingApiRoutes);
   ```

5. **Astro Integration**
   ```dockerfile
   # Add to claude-code-container/Dockerfile
   COPY amelia-astro/ ./web/
   RUN cd ./web && npm install && npm run build
   ```

### Step 3: Basic Session Integration (2-3 days)  
6. **Hard-coded Client Support**
   ```typescript
   // Update EditSessionService.createSession()
   session.previewUrl = `https://edit.amelia.webordinary.com/session/${sessionId}`;
   
   // Keep existing container wake/routing logic from Task 21
   // No changes needed to session resumption
   ```

7. **Container Route Handling**
   ```typescript
   // Add to container API
   app.get('/session/:sessionId', async (req, res) => {
     const { sessionId } = req.params;
     const session = await validateSession(sessionId);
     if (!session) return res.status(404).send('Session not found');
     
     // Serve Astro app
     res.sendFile('./web/dist/client/index.html');
   });
   ```

## Technical Architecture (MVP)

### Simplified Request Flow
```
User → edit.amelia.webordinary.com 
     → ALB (TLS termination, hard-coded routing)
     → Existing Target Group (Amelia containers)
     → Container:8080 (Express + Astro static files)
     → Astro Web Interface
```

### Container Structure (Updated)
```
claude-code-container/
├── src/                    # Existing API services
│   ├── app.ts             # Updated: serve web + API  
│   └── routes/            # Existing API routes
├── web/                    # Astro static build
│   └── dist/              # Built Astro app
│       └── client/        # Static files to serve
├── Dockerfile             # Updated: include web build
└── package.json           # Existing dependencies
```

### Session States (No Changes)
- Use existing session resumption logic from Task 21
- Use existing container wake behavior  
- Hard-code clientId = "amelia" for MVP
- Future tasks (24-26) will generalize this

## Configuration Requirements (MVP)

### Environment Variables
```bash
# Container configuration (hard-coded for Amelia)
CLIENT_ID=amelia
WEB_ENABLED=true
PORT=8080
```

### AWS Resources Required
- **Route 53**: DNS record for edit.amelia.webordinary.com  
- **ACM**: Certificate for *.amelia.webordinary.com
- **ALB**: Listener rule for edit.amelia.webordinary.com → existing target group
- **ECS**: Updated task definition to include web files

## Testing Strategy (MVP)

### Manual Testing
1. **DNS Resolution**: `nslookup edit.amelia.webordinary.com`
2. **Certificate Validation**: Browser security check  
3. **Container Web Server**: Verify Astro serves on port 8080
4. **Session Integration**: Test with existing session resumption from Task 21

### Integration Testing
- Extend Task 22 framework to test web interface
- Validate container serves both API and web content
- Test session wake behavior with web interface

## Success Criteria (MVP)
- [ ] DNS resolves edit.amelia.webordinary.com to ALB
- [ ] TLS certificate validates for edit.amelia.webordinary.com  
- [ ] ALB routes to existing Amelia containers
- [ ] Containers serve Astro web interface on port 8080
- [ ] Existing session resumption logic works with web interface
- [ ] Basic web-based editing environment functional
- [ ] No breaking changes to existing API functionality

## Dependencies
- **Task 21**: Session resumption service (completed)
- **Task 22**: Integration testing framework (completed)
- **Infrastructure**: Existing ALB and ECS setup for Amelia
- **Content**: amelia-astro repository for web interface

## Risks and Mitigation (MVP)
1. **Certificate**: Request *.amelia.webordinary.com certificate
2. **Container Resources**: Monitor container performance with web server
3. **Port Conflicts**: Ensure clean migration from multi-port to single-port
4. **Breaking Changes**: Maintain API compatibility during web integration

## Out of Scope (Future Tasks)
- Multi-client support → **Task 24**
- Dynamic client configuration → **Task 25** 
- Automated client onboarding → **Task 26**
- Advanced routing/session management → **Task 24-26**

## Deliverables
- Working edit.amelia.webordinary.com web interface
- Updated container with integrated web server
- ALB configuration for edit subdomain
- Basic documentation for web interface access