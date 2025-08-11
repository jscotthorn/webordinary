# Task 04: Remove Web Server from Container

## Objective
Strip out the Express web server and all HTTP-related code from the claude-code-container, as we're moving to S3 static hosting.

## Context
The container currently runs an Express server on port 8080 to serve the Astro build. We're removing this entirely since S3 will handle all web serving.

## Changes Required

### 1. Remove Web Server Files
```bash
cd /Users/scott/Projects/webordinary/claude-code-container

# Files to remove
rm src/services/web-server.service.ts
rm src/services/auto-sleep.service.ts  # If it depends on web server
rm src/services/auto-sleep.service.integration.spec.ts
```

### 2. Update main.ts
Remove web server initialization and port binding:
```typescript
// Remove these imports
// import { WebServerService } from './services/web-server.service';

// Remove port 8080 references
// Remove app.listen() or similar
```

### 3. Update app.module.ts
Remove web server from providers:
```typescript
@Module({
  imports: [SqsModule.register({...})],
  providers: [
    MessageProcessorService,
    GitService,
    // Remove: WebServerService,
    // Remove: AutoSleepService,
  ],
})
```

### 4. Simplify Dockerfile
```dockerfile
FROM node:20-alpine

# No need to EXPOSE 8080 anymore
# Remove health check endpoints

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

# Simplified entrypoint - just process messages
CMD ["node", "dist/main.js"]
```

### 5. Remove Health Check Scripts
```bash
rm scripts/health-check.sh
# Update scripts/entrypoint.sh to remove health check logic
```

### 6. Update package.json
Remove any web server dependencies if they're not used elsewhere:
```json
// Check if these can be removed:
// "express": "^x.x.x",
// Any other HTTP server packages
```

## Testing
```bash
# Build locally
npm run build

# Run without web server
node dist/main.js
# Should start and begin processing SQS messages
# Should NOT say "listening on port 8080" or similar
```

## Acceptance Criteria
- [ ] All web server code removed
- [ ] Container builds successfully
- [ ] Container starts without trying to bind to port
- [ ] SQS message processing still works
- [ ] No health check errors in logs

## Time Estimate
1-2 hours

## Notes
- Keep the SQS message processing intact
- Keep the Git service intact
- This is just removing the HTTP layer