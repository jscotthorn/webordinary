# Claude Code Container Refactor Checklist

## Priority 1: Remove Web Server Code

- [ ] Search for Express server initialization
- [ ] Remove any `app.listen()` calls
- [ ] Delete Express routes (`/api/*`, `/health`, etc.)
- [ ] Remove port 8080 configuration
- [ ] Delete Express dependencies if unused elsewhere
- [ ] Remove HTTP server related types/interfaces

## Priority 2: Update Terminology

- [ ] Replace "session container" with "project+user container" in comments
- [ ] Update variable names from session-focused to project+user-focused
- [ ] Ensure claim logic uses project+user identifiers
- [ ] Update log messages to reflect new patterns

## Priority 3: Clean Message Processing

- [ ] Verify WorkMessage interface matches current needs
- [ ] Ensure repoUrl is properly handled
- [ ] Confirm instruction processing flow
- [ ] Validate S3 deployment after build
- [ ] Check git commit/push workflow

## Priority 4: Update Tests

- [ ] Remove HTTP endpoint tests
- [ ] Remove WebSocket tests
- [ ] Add/verify S3 deployment tests
- [ ] Test claim/unclaim patterns
- [ ] Test interrupt handling
- [ ] Verify git operations tests

## Priority 5: Documentation

- [ ] Update README.md with current architecture
- [ ] Remove references to web serving
- [ ] Document S3 deployment clearly
- [ ] Update message schema documentation
- [ ] Clean CLAUDE.md quick reference

## Priority 6: Configuration

- [ ] Remove port configurations
- [ ] Clean environment variables
- [ ] Update Docker configuration
- [ ] Verify health check approach (CloudWatch logs)

## Code Locations to Check

```
src/
├── main.ts                 # Check for Express setup
├── app.module.ts          # Check imports
├── message-processor/     # Core logic - verify flow
├── services/
│   ├── git.service.ts    # Should be current
│   ├── s3.service.ts     # Verify deployment logic
│   └── claude.service.ts # Check integration
└── config/                # Environment configs
```

## Testing Commands

```bash
# After removing web server
npm test

# Verify S3 deployment
AWS_PROFILE=personal npm test s3

# Test message processing
AWS_PROFILE=personal npm test integration

# Check for build issues
npm run build
```

## Verification Steps

1. Container starts without port binding
2. Successfully processes SQS messages
3. Claims project+user correctly
4. Switches to correct EFS directory
5. Clones/checkouts git properly
6. Runs Claude Code CLI
7. Builds Astro project
8. Syncs to S3 successfully
9. Commits and pushes to git
10. Handles interrupts gracefully

## Dependencies to Review

```json
{
  "remove": [
    "express",
    "ws",
    "@types/express",
    "@types/ws"
  ],
  "keep": [
    "@nestjs/common",
    "@ssut/nestjs-sqs",
    "aws-sdk",
    "@anthropic-ai/sdk"
  ]
}
```

## Success Criteria

- [ ] No HTTP server running
- [ ] No port 8080 references
- [ ] Clean SQS → Process → S3 flow
- [ ] All tests passing
- [ ] Documentation accurate
- [ ] CloudWatch logging working