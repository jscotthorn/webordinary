# Claude Code Container Scripts

This directory contains scripts for managing and testing the Claude Code Container.

## Container Entrypoints

### `entrypoint.sh`
**Purpose:** Production container entrypoint
- Configures git with GitHub token
- Validates AWS credentials (IAM role in production)
- Sets up workspace permissions
- Starts the Node.js application
- Handles graceful shutdown

### `entrypoint-local.sh`
**Purpose:** Development container entrypoint (more forgiving)
- Skips AWS credential verification for local development
- Uses simulation mode for Claude API when needed
- Builds TypeScript if not already built
- More lenient error handling for development

## Health Check Script

### `health-check-sqs.sh`
**Purpose:** Basic health check for ECS
- Simple check if main process is running
- Returns 0 (healthy) or 1 (unhealthy)
- Used by ECS health checks in production

## Utility Scripts

### `verify-bedrock.sh`
**Purpose:** Verify Bedrock access and configuration
- Checks AWS credentials
- Lists available Claude models in Bedrock
- Tests model invocation capability
- Verifies environment variables
- Provides configuration recommendations
- Tests with Claude 3.5 Haiku model

## Environment Variables

Key environment variables used by these scripts:

### AWS Configuration
- `AWS_PROFILE` - AWS CLI profile to use
- `AWS_REGION` - AWS region (default: us-west-2)
- `AWS_ACCESS_KEY_ID` - AWS access key
- `AWS_SECRET_ACCESS_KEY` - AWS secret key

### Container Configuration
- `NODE_ENV` - Environment (development/production)
- `WORKSPACE_PATH` - Container workspace directory
- `GITHUB_TOKEN` - GitHub personal access token
- `CLAUDE_CODE_USE_BEDROCK` - Enable Bedrock integration
- `LOG_LEVEL` - Logging verbosity

### Queue Configuration
- `UNCLAIMED_QUEUE_URL` - Queue for available work
- `INPUT_QUEUE_URL` - Queue for incoming messages
- `OUTPUT_QUEUE_URL` - Queue for outgoing messages

## Usage Examples

### Verify Bedrock Setup
```bash
./scripts/verify-bedrock.sh
```

### Check Container Health
```bash
docker exec claude-container /app/scripts/health-check-sqs.sh
```

### Production Deployment
The entrypoint.sh script is automatically used when the container starts in ECS.

## Notes

- Production uses IAM roles for AWS credentials
- Development can use mounted AWS credentials
- Health checks are used by ECS for container monitoring
- Bedrock integration requires proper IAM permissions