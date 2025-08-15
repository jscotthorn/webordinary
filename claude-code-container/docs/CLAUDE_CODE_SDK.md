# Claude Code SDK Integration with AWS Bedrock

## Overview

The Claude Code container uses the official `@anthropic-ai/claude-code` TypeScript SDK directly (not CLI) configured to work with AWS Bedrock and the latest Claude Sonnet model for executing AI-powered code generation and modification tasks.

## Configuration

### Environment Variables for Bedrock

```bash
# Enable Bedrock backend (required)
CLAUDE_CODE_USE_BEDROCK=1

# Model configuration (using aliases for latest versions)
ANTHROPIC_MODEL=sonnet  # Uses latest Claude Sonnet
ANTHROPIC_SMALL_FAST_MODEL=haiku  # Uses latest Claude Haiku for fast operations

# Token limits
CLAUDE_CODE_MAX_OUTPUT_TOKENS=4096
MAX_THINKING_TOKENS=1024

# AWS configuration (required)
AWS_REGION=us-west-2
AWS_PROFILE=personal  # or use IAM role in production

# For local development/testing
CLAUDE_SIMULATION_MODE=true  # Set to false for real Bedrock calls
```

### Authentication

When using Bedrock, authentication is handled via AWS credentials:
- **Local**: Uses AWS_PROFILE from ~/.aws/credentials
- **ECS/Production**: Uses IAM role attached to task
- **No ANTHROPIC_API_KEY needed** - Bedrock handles authentication

## How It Works

### TypeScript SDK Implementation

The container uses the `@anthropic-ai/claude-code` TypeScript SDK directly:

```typescript
import { query } from '@anthropic-ai/claude-code';

// Execute Claude Code with Bedrock
for await (const message of query({
  prompt: instruction,
  options: {
    cwd: projectPath,      // Working directory
    model: 'sonnet',       // Latest Sonnet model
    maxTurns: 3,          // Limit conversation turns
    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'LS', 'Glob']
  }
})) {
  // Process streaming messages
}
```

### Production Mode (Real Claude Code via Bedrock)

When `CLAUDE_SIMULATION_MODE=false`:

1. The SDK connects to AWS Bedrock using AWS credentials
2. Executes using the latest Claude Sonnet model
3. Processes messages in real-time via async iteration
4. File changes are detected via Git operations
5. Returns structured response with:
   - `output`: The result text
   - `filesChanged`: Array of modified file paths
   - `summary`: Task summary
   - `cost`: USD cost of API usage ($0.065 typical)
   - `duration`: Execution time in ms (~50 seconds typical)
   - `sessionId`: Unique session identifier

### Simulation Mode (Development)

When `CLAUDE_SIMULATION_MODE=true`:
- Creates a test HTML file to demonstrate the workflow
- Returns mock response with filesChanged array
- No API calls or costs incurred

## Message Processing

The SDK yields different message types during execution:

```typescript
// System message - session initialization
{ type: 'system', session_id: '...', subtype: 'init' }

// Assistant messages - Claude's responses and tool uses
{ type: 'assistant', message: { content: [...] } }

// Result message - completion with metrics
{ 
  type: 'result', 
  subtype: 'success',
  total_cost_usd: 0.065,
  duration_ms: 51000,
  session_id: '...'
}
```

## Response Format

```json
{
  "success": true,
  "output": "Task completed successfully",
  "summary": "Created new component",
  "filesChanged": [
    "src/components/NewComponent.tsx",
    "src/index.ts"
  ],
  "cost": 0.0125,
  "duration": 3500
}
```

## Allowed Tools

The SDK is configured to use these tools:
- `Read` - Read file contents
- `Edit` - Modify existing files
- `Write` - Create new files
- `Bash` - Execute shell commands
- `Grep` - Search file contents
- `LS` - List directory contents
- `Glob` - Find files by pattern

## Error Handling

- JSON parsing failures fall back to raw text output
- File change detection falls back to parsing tool_calls
- 5-minute timeout for long-running operations
- 10MB buffer for large outputs

## Testing

```bash
# Run with simulation mode (no Bedrock calls)
CLAUDE_SIMULATION_MODE=true npm start

# Run with real Bedrock (requires AWS credentials)
CLAUDE_SIMULATION_MODE=false npm start
```

### Verified Test Results

Successfully tested with real AWS Bedrock:
- **Task**: Changed "Welcome to My Site" to "Amelia Stamps Pottery"
- **Model**: Claude Sonnet (latest)
- **Cost**: $0.065
- **Duration**: 51 seconds
- **Result**: File modified, committed, and pushed to GitHub

## Migration from Simulation to Bedrock

To enable real Claude Code via Bedrock:

1. Ensure AWS credentials are configured (AWS_PROFILE or IAM role)
2. Verify Bedrock access in us-west-2 region
3. Set `CLAUDE_SIMULATION_MODE=false` in environment
4. Deploy and monitor costs via response metrics

### Required IAM Permissions for Bedrock

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:us-west-2:*:model/us.anthropic.claude-3-7-sonnet*",
        "arn:aws:bedrock:us-west-2:*:model/us.anthropic.claude-3-5-haiku*"
      ]
    }
  ]
}
```

## Cost Optimization

- Use `maxTurns` option to limit conversation length (default: 3)
- Restrict `allowedTools` to necessary operations only
- Monitor `cost` field in responses (typical: $0.065 per task)
- Consider caching for repeated operations
- Use simulation mode for development/testing

## Implementation Details

- **Package**: `@anthropic-ai/claude-code` v1.0.81
- **Method**: Direct TypeScript SDK integration (not CLI)
- **Backend**: AWS Bedrock in us-west-2
- **Model**: Latest Claude Sonnet via `model: 'sonnet'` alias
- **File**: `/src/services/claude-executor.service.ts`