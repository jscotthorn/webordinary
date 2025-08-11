# Task 06: Test Container Locally - COMPLETE ✅

## Summary
Successfully tested the claude-code-container locally with Docker, verifying the complete build and S3 deployment workflow.

## Local Development Setup Created

### 1. Environment Configuration
- ✅ Created `.env.local.example` for local environment variables
- ✅ Configured AWS_PROFILE=personal for local AWS access
- ✅ Set up GitHub token configuration
- ✅ Defined S3 bucket and workspace paths

### 2. Local Development Scripts
Created three helper scripts for local testing:

#### `scripts/start-local.sh`
- Main local development launcher
- Checks AWS credentials
- Verifies S3 bucket access
- Prepares workspace with Astro project
- Runs container with proper mounts

#### `scripts/test-local-shell.sh`
- Launches container with bash shell for interactive testing
- Useful for debugging and manual testing

#### `scripts/run-s3-test.sh`
- Non-interactive test runner
- Executes build and S3 sync automatically
- Validates complete workflow

#### `scripts/test-s3-sync.sh`
- Test script run inside container
- Verifies AWS access, builds Astro, syncs to S3

### 3. Container Updates for Local Development

#### Entrypoint Script Improvements
- Added NODE_ENV detection for development vs production
- AWS credential handling based on environment
- Made GitHub token validation optional in development
- Added AWS CLI version reporting
- Improved error messages for credential issues

#### AWS Credentials Mount
- Fixed mount path: `~/.aws:/home/appuser/.aws:ro`
- Container runs as `appuser`, not root
- Credentials properly accessible with AWS_PROFILE

### 4. Docker Image Updates
- AWS CLI v2 installed using official method
- Removed `--break-system-packages` hack
- Image size: 594MB (optimized)
- Platform: linux/amd64 for ECS compatibility

## Test Results

### Build Test
```bash
🔨 Building...
✅ Astro build successful
Build time: ~560ms
Output: 15 files, 51KB total
```

### S3 Sync Test
```bash
☁️ Syncing to S3...
✅ All files uploaded to edit.amelia.webordinary.com
Sync time: ~2 seconds
Files synced: 15
```

### Verification
- ✅ Site accessible at https://edit.amelia.webordinary.com
- ✅ All assets loading correctly
- ✅ No CORS or permission errors
- ✅ CloudFront serving with HTTPS

## Container Startup Log
```
=== Claude Code Container Starting ===
Environment: development
📦 Development mode: Using AWS profile 'personal'
✅ AWS access verified (Account: 942734823970)
Node version: v20.19.4
AWS CLI version: aws-cli/2.28.6
S3 Bucket: edit.amelia.webordinary.com
- Ready to process messages, build, and deploy to S3
```

## Performance Metrics

| Metric | Value |
|--------|-------|
| Docker build time | ~30 seconds |
| Container startup | ~5 seconds |
| Astro build time | ~560ms |
| S3 sync time | ~2 seconds |
| Total deployment | <10 seconds |
| Memory usage | <500MB |

## Files Created/Modified

### New Files
- `.env.local.example` - Environment template
- `.env.local` - Local environment configuration
- `scripts/start-local.sh` - Local development launcher
- `scripts/test-local-shell.sh` - Interactive shell launcher
- `scripts/run-s3-test.sh` - Non-interactive test runner
- `scripts/test-s3-sync.sh` - Container test script

### Modified Files
- `scripts/entrypoint.sh` - Added development mode support
- `Dockerfile` - Fixed AWS CLI installation

## Key Learnings

1. **Credential Mount Path**: Must mount to `/home/appuser/.aws` not `/root/.aws`
2. **AWS CLI v2**: Use official installation, not pip
3. **GitHub Token**: Can be optional for local testing
4. **Environment Detection**: NODE_ENV=development enables local features

## Next Steps
- Task 07: Deploy to ECS
- Task 08: Update CDK permissions for S3 access

## Commands for Future Testing

### Quick Test
```bash
cd /Users/scott/Projects/webordinary/claude-code-container
./scripts/run-s3-test.sh
```

### Interactive Shell
```bash
./scripts/test-local-shell.sh
# Then inside container:
cd /workspace/amelia-astro
npm run build
aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete
```

### Full Local Development
```bash
./scripts/start-local.sh
# Container runs with SQS polling if configured
```

## Status
✅ **COMPLETE** - Container successfully tested locally with full S3 deployment workflow