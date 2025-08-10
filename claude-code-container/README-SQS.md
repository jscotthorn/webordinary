# Claude Code Container with SQS Support

This is the updated Claude Code container that uses SQS message queues instead of HTTP APIs for communication with Hermes.

## Architecture

The container now uses NestJS with `@ssut/nestjs-sqs` for decorator-based SQS message handling:

- **Single Queue Per Container**: Each container (user+project) has one input and one output queue
- **Automatic Interrupts**: Any new message interrupts current Claude Code execution
- **Git Branch Management**: Automatically switches branches based on chat thread ID
- **Astro Dev Server**: Runs continuously in the background on port 4321

## Environment Variables

```bash
# Required for SQS
INPUT_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/xxx/webordinary-input-clientId-projectId-userId
OUTPUT_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/xxx/webordinary-output-clientId-projectId-userId
AWS_REGION=us-west-2

# Container configuration
WORKSPACE_PATH=/workspace
CLIENT_ID=ameliastamps
PROJECT_ID=website
USER_ID=john
ASTRO_PORT=4321
PREVIEW_DOMAIN=preview.webordinary.com

# Optional
REPO_URL=https://github.com/ameliastamps/amelia-astro.git
AWS_ACCOUNT_ID=942734823970
```

## Message Schema

### Input Message (from Hermes)
```typescript
{
  sessionId: string;        // Chat thread ID
  commandId: string;        // Unique command identifier
  timestamp: number;
  type: 'edit' | 'build' | 'commit' | 'push' | 'preview';
  instruction: string;
  userEmail: string;
  chatThreadId: string;     // For git branch switching
  context: {
    branch: string;         // Current git branch
    lastCommit?: string;
    filesModified?: string[];
  };
}
```

### Output Message (to Hermes)
```typescript
{
  sessionId: string;
  commandId: string;
  timestamp: number;
  success: boolean;
  summary: string;
  filesChanged?: string[];
  error?: string;
  previewUrl?: string;
  interrupted?: boolean;    // True if interrupted by new message
}
```

## Building and Deployment

### Build Docker Image
```bash
# Build with default tag (latest)
./build-sqs.sh

# Build with specific tag
./build-sqs.sh v1.0.0
```

### Test Locally
```bash
# Run with mock queue URLs
docker run -it \
  -e INPUT_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/xxx/test-input \
  -e OUTPUT_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/xxx/test-output \
  -e AWS_REGION=us-west-2 \
  -e WORKSPACE_PATH=/workspace \
  webordinary/claude-code-sqs:latest
```

### Deploy to Fargate
Update your task definition to use the new image:
```
942734823970.dkr.ecr.us-west-2.amazonaws.com/webordinary/claude-code-sqs:latest
```

## Development

### Install Dependencies
```bash
npm install
```

### Build TypeScript
```bash
npm run build
```

### Run Locally (without Docker)
```bash
# Set environment variables
export INPUT_QUEUE_URL=...
export OUTPUT_QUEUE_URL=...

# Run in development mode
npm run dev

# Run compiled version
npm start
```

## Key Features

### Interrupt Handling
When a new message arrives while processing:
1. Current Claude Code process receives SIGINT
2. Process has 5 seconds to save state
3. Changes are auto-committed with message "Interrupted by new message"
4. New message processing begins immediately

### Session Management
- Each chat thread gets its own git branch: `thread-{chatThreadId}`
- Auto-commits before switching sessions
- Preserves work across session switches
- Multiple sessions can be handled by the same container

### Error Handling
- Failed messages retry up to 3 times
- After 3 failures, messages go to DLQ
- Processing errors are logged and reported back to Hermes
- Container continues running even after errors

## Migration from HTTP API

### Key Changes
1. **No Express Server**: Removed port 8080 API server
2. **SQS Polling**: Uses long polling (20 seconds) for efficient message retrieval
3. **Decorator-based**: Clean NestJS decorators for message handling
4. **Automatic Interrupts**: Built-in support for message interruption
5. **Simplified Architecture**: One queue per container instead of complex discovery

### Backwards Compatibility
The legacy Express server is still available at `src/server.ts` and can be run with:
```bash
npm run start:legacy
```

## Monitoring

### CloudWatch Logs
The container logs to CloudWatch with structured logging:
- Message receipt and processing
- Git operations
- Interrupt events
- Error details

### SQS Metrics
Monitor via CloudWatch:
- Messages sent/received
- Message age
- DLQ messages
- Processing time

## Troubleshooting

### Container doesn't receive messages
- Check INPUT_QUEUE_URL is correct
- Verify IAM permissions for SQS
- Check CloudWatch logs for connection errors

### Messages going to DLQ
- Check processing timeout (5 minutes default)
- Review error logs for failure reasons
- Verify Claude Code CLI is installed in container

### Git branch issues
- Ensure workspace has git initialized
- Check for uncommitted changes blocking branch switch
- Verify git credentials if using private repos