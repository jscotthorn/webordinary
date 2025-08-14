# Local Development Build Issue Resolution

**Date**: 2025-08-14  
**Issue**: Docker build cache preventing TypeScript changes from being compiled

## Problem Summary

Despite making critical fixes to the Hermes service code, the Docker build process was not compiling the updated TypeScript files into JavaScript. The container continued to run old code even after multiple rebuild attempts.

### Symptoms
- Changes to TypeScript files were present in source but not in compiled `/app/dist` directory
- `docker compose build` appeared successful but used cached layers
- Even `--no-cache` flag initially didn't resolve the issue due to buildx cache

### Root Cause
Docker's multi-layer caching system was preserving the build output from the `RUN npm run build` step, even when source files changed. This is a known issue with Docker builds when:
1. The build context appears unchanged to Docker
2. BuildKit/buildx maintains its own cache separate from Docker's image cache
3. The TypeScript compilation step is cached independently

## Solution Steps

### 1. Clear ALL Docker Caches
```bash
# Stop all containers
docker compose -f docker-compose.local.yml down

# Clear buildx cache (critical step)
docker buildx prune -af

# Optional: Clear system-wide cache
docker system prune -a
```

### 2. Force Complete Rebuild
```bash
# Build with absolutely no cache
docker compose -f docker-compose.local.yml build --no-cache hermes
docker compose -f docker-compose.local.yml build --no-cache claude-container
```

### 3. Verify Build Output
```bash
# Check that new code is compiled
docker exec webordinary-hermes-1 grep "new EmailReplyParser" /app/dist/modules/email-processor/email-processor.service.js
```

### 4. Manual Rebuild Inside Container (Workaround)
If the issue persists, you can manually rebuild inside the container:
```bash
# Rebuild TypeScript inside container
docker exec webordinary-hermes-1 sh -c "cd /app && npm run build"

# Restart container to use new build
docker compose -f docker-compose.local.yml restart hermes
```

## Prevention Strategies

### 1. Dockerfile Best Practices
```dockerfile
# Copy source files AFTER dependencies
COPY package*.json ./
RUN npm ci
COPY src/ ./src/  # This should invalidate cache when source changes
RUN npm run build
```

### 2. Development Workflow
For local development, consider:
- Using volume mounts for source code
- Running TypeScript in watch mode
- Using nodemon for auto-restart

### 3. Build Verification Script
Create a script to verify builds:
```bash
#!/bin/bash
# verify-build.sh
echo "Checking build timestamp..."
docker exec webordinary-hermes-1 stat /app/dist/main.js
echo "Checking for recent code changes..."
docker exec webordinary-hermes-1 grep "YOUR_RECENT_CHANGE" /app/dist/
```

## Lessons Learned

1. **Docker caching is complex** - Multiple cache layers (Docker daemon, BuildKit, buildx) can all interfere
2. **Always verify compiled output** - Don't assume a successful build means new code is running
3. **Source changes don't always invalidate cache** - Docker may not detect all file changes
4. **buildx maintains separate cache** - `docker buildx prune` is essential when cache issues occur

## Current Status After Resolution

### What Works ✅
- Build process now compiles latest TypeScript changes
- Container starts successfully with new code
- All Docker caches have been cleared

### Issues That Were Resolved ✅

After clearing the build cache and rebuilding, we successfully fixed:

1. **Email routing** - Now correctly identifies `ameliastamps/scott` from email `escottster@gmail.com`
2. **Project identification** - No longer falls back to "default/unknown"
3. **Queue routing** - Messages successfully route to `webordinary-input-ameliastamps-scott`
4. **Message flow** - Complete flow from Email → Hermes → Claude Container works

### Additional Fixes Applied

1. **MessageRouterService constructor** - Removed constructor parameters to fix DI error
2. **Project configuration** - Changed from "amelia" to "ameliastamps" to match queue names
3. **EmailReplyParser** - Fixed from `.parse()` to `new EmailReplyParser().read()`
4. **Path duplication** - Fixed `/workspace/{projectId}/{userId}/{repoName}` structure

### Working Manual Start Commands

If docker-compose fails, these manual commands work:
```bash
# Start Hermes with manual build
docker run -d --name hermes-manual \
  --env-file hermes/.env.local \
  -e AWS_PROFILE=personal \
  -v ~/.aws:/home/hermes/.aws:ro \
  --network webordinary_webordinary-local \
  webordinary-hermes sh -c "npm run build && node dist/main.js"

# Start Claude container
docker run -d --name claude-manual \
  --env-file claude-code-container/.env.local \
  -e AWS_PROFILE=personal \
  -v ~/.aws:/home/appuser/.aws:ro \
  --network webordinary_webordinary-local \
  --entrypoint node \
  webordinary-claude-container dist/main.js
```

## Commands Reference

```bash
# Complete cache clear and rebuild sequence
docker compose -f docker-compose.local.yml down
docker buildx prune -af
docker system prune -a  # Optional but thorough
docker compose -f docker-compose.local.yml build --no-cache
docker compose -f docker-compose.local.yml up -d

# Verify services are running
docker compose -f docker-compose.local.yml ps
docker compose -f docker-compose.local.yml logs --tail=50

# Send test email
./scripts/send-test-email.sh

# Check routing
docker compose -f docker-compose.local.yml logs hermes | grep "Routing message"
```

## Conclusion

The Docker build caching issue has been resolved through aggressive cache clearing using `docker buildx prune -af`. Additionally, all email routing issues have been fixed and the complete flow from Email → Hermes → Claude Container is now working. The local development environment is fully functional for testing the end-to-end message processing pipeline.

### Key Takeaways
1. **Always clear buildx cache** when TypeScript changes aren't being compiled
2. **Check compiled output** in `/app/dist` to verify builds are working
3. **Manual build inside container** can be a useful debugging technique
4. **AWS credentials must be mounted** to the correct user home directory
5. **Project mapping in Hermes** must match actual queue names exactly