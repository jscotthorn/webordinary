# WebOrdinary Scripts

Scripts for testing and managing the WebOrdinary E2E flow.

## Local Claude Container Management

### `start-local-claude.sh`
Starts a local Claude container that integrates with the E2E message flow.

```bash
# Start with default image (final-fix)
./scripts/start-local-claude.sh

# Build and start with local changes
./scripts/start-local-claude.sh --build
```

The container will:
- Poll the unclaimed queue for work
- Process messages from Step Functions
- Execute Claude via AWS Bedrock
- Push changes to GitHub
- Deploy to S3

**Requirements:**
- AWS credentials configured in `[personal]` profile
- `GITHUB_TOKEN` with write permissions to `jscotthorn/amelia-astro`
- Docker installed and running

### `stop-local-claude.sh`
Stops and removes the local Claude container.

```bash
./scripts/stop-local-claude.sh
```

Shows container stats and recent logs before stopping.

## Testing Scripts

### `test-aws-email.sh`
Sends a test email directly to S3 to trigger the full E2E flow.

```bash
./scripts/test-aws-email.sh
```

This will:
1. Upload an email to S3
2. Trigger Lambda function
3. Start Step Functions execution
4. Send message to container via SQS

### `test-bedrock-e2e.sh`
Tests Claude container with Bedrock integration.

```bash
# Test with direct SQS message
./scripts/test-bedrock-e2e.sh

# Test with full email flow
./scripts/test-bedrock-e2e.sh --full
```

## Full E2E Testing Workflow

1. **Start the local container:**
   ```bash
   ./scripts/start-local-claude.sh
   ```

2. **Send a test email:**
   ```bash
   ./scripts/test-aws-email.sh
   ```

3. **Monitor the flow:**
   ```bash
   # Watch container logs
   docker logs -f claude-local-e2e
   
   # Check Step Functions
   AWS_PROFILE=personal aws stepfunctions list-executions \
     --state-machine-arn arn:aws:states:us-west-2:942734823970:stateMachine:email-processor \
     --max-items 1
   
   # Check GitHub for new branch
   open https://github.com/jscotthorn/amelia-astro/branches
   ```

4. **Stop the container:**
   ```bash
   ./scripts/stop-local-claude.sh
   ```

## Environment Variables

The scripts use these environment variables:
- `GITHUB_TOKEN`: GitHub personal access token with write permissions
- `AWS_PROFILE`: Set to `personal` for AWS operations
- `WORKSPACE_PATH`: Container workspace (default: `/workspace`)

## Docker Images

- `webordinary/claude-code-container:final-fix` - Latest stable version with all fixes
- `webordinary/claude-code-container:local` - Built locally with `--build` flag

## Troubleshooting

### Container won't start
- Check if another container is already running: `docker ps | grep claude`
- Ensure AWS credentials are configured: `aws configure list --profile personal`
- Verify GitHub token: `echo $GITHUB_TOKEN`

### Messages not processing
- Check container logs: `docker logs claude-local-e2e`
- Verify Step Functions execution: Check AWS Console or CLI
- Ensure SQS queues exist: Check AWS Console

### GitHub push failing
- Verify token has write permissions
- Check if branch already exists
- Ensure repository URL is correct