# Docker E2E Testing Setup

## Overview
This document describes the Docker-based E2E testing setup for claude-code-container, which replaces the previous local Node.js execution approach.

## What Changed

### Previous Setup (Local Node)
- Tests ran claude-code-container directly with Node.js on the host machine
- Required local environment setup and dependencies
- Mixed host and container environments caused issues

### New Setup (Docker Container)
- Tests run claude-code-container inside a Docker container
- Consistent environment matching production
- Proper AWS credentials and GitHub token passed to container

## Files Created/Modified

### New Files
1. **docker-compose.test.yml** - Docker Compose configuration for testing
2. **scripts/run-e2e-docker.sh** - Full-featured E2E test runner
3. **scripts/test-container-e2e.sh** - Simplified container test script
4. **.env.test** - Test environment configuration
5. **tests/integration/scenarios/docker-container.test.ts** - Jest test suite

### Modified Files
1. **package.json** - Added Docker test scripts
2. **src/services/claude-executor.service.ts** - Fixed merge conflicts
3. **src/services/git.service.ts** - Fixed merge conflicts, updated to use `origin/main`

## Usage

### Quick Test
```bash
# From claude-code-container directory
npm run test:docker
```

### Build Only
```bash
npm run test:docker:build
```

### View Logs
```bash
npm run test:docker:logs
```

### Clean Up
```bash
npm run test:docker:clean
```

### Advanced Usage
```bash
# Run specific test type
./scripts/test-container-e2e.sh test basic
./scripts/test-container-e2e.sh test s3
./scripts/test-container-e2e.sh test stepfunction

# Using the full-featured script
./scripts/run-e2e-docker.sh test basic
./scripts/run-e2e-docker.sh build
./scripts/run-e2e-docker.sh logs
```

## Environment Requirements

### Required Environment Variables
- `GITHUB_TOKEN` - GitHub personal access token
- `AWS_PROFILE` or `AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY` - AWS credentials

### Setting Up
```bash
export GITHUB_TOKEN=your_github_token
export AWS_PROFILE=personal  # or set AWS credentials directly
```

## Docker Configuration

### docker-compose.test.yml
- Builds container from Dockerfile
- Mounts workspace directory for file operations
- Passes AWS credentials and GitHub token
- Configures queue URLs and DynamoDB tables
- Sets resource limits (2GB RAM, 1 CPU)

### Container Environment
- Runs as non-root user (appuser)
- Workspace at `/workspace`
- AWS CLI v2 installed
- Claude Code SDK configured for Bedrock
- Node.js 20 runtime

## Test Scenarios

### Basic Test
- Creates simple files
- Tests basic Claude Code functionality

### S3 Deployment Test
- Creates Astro site
- Deploys to S3 bucket
- Verifies deployment

### Step Functions Test
- Handles task tokens
- Tests callback integration
- Validates message processing

## Troubleshooting

### Build Errors
```bash
# Clean build
docker buildx prune -af
npm run test:docker:build
```

### Permission Issues
```bash
# Ensure scripts are executable
chmod +x scripts/*.sh
```

### AWS Credentials
```bash
# Verify credentials
aws sts get-caller-identity --profile personal
```

### Container Won't Start
```bash
# Check logs
docker logs claude-code-e2e-test

# Clean up
docker rm -f claude-code-e2e-test
```

## Benefits

1. **Consistency** - Same environment as production
2. **Isolation** - No host system pollution
3. **Reproducibility** - Tests run identically across machines
4. **Security** - Credentials passed securely
5. **Debugging** - Easy log access and container inspection

## Next Steps

1. Run tests in CI/CD pipeline
2. Add more test scenarios
3. Performance benchmarking
4. Integration with Step Functions testing