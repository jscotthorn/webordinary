# Hermes Refactor Checklist

## Priority 1: Clarify Claiming Pattern

- [ ] Document project+user claiming clearly
- [ ] Ensure unclaimed queue logic is explicit
- [ ] Verify claim state management in DynamoDB
- [ ] Update terminology from session-centric to project+user-centric
- [ ] Add clear logging for claim operations

## Priority 2: Remove Legacy HTTP Patterns

- [ ] Identify which HTTP endpoints are needed (health only?)
- [ ] Remove unnecessary API endpoints
- [ ] Keep only `/hermes/health` for ALB health checks
- [ ] Remove any web routing logic
- [ ] Clean up controller methods

## Priority 3: Queue Management

- [ ] Verify email queue processing
- [ ] Ensure project+user queue creation
- [ ] Validate unclaimed queue operations
- [ ] Check DLQ handling
- [ ] Test queue cleanup logic

## Priority 4: Message Schema Alignment

- [ ] Verify WorkMessage includes repoUrl
- [ ] Ensure ClaimRequest format is correct
- [ ] Validate ResponseMessage handling
- [ ] Check message type guards
- [ ] Update shared types if needed

## Priority 5: DynamoDB Schema

- [ ] Review thread-mappings table structure
- [ ] Check container tracking table
- [ ] Verify session table usage
- [ ] Ensure indexes support queries
- [ ] Document table schemas clearly

## Priority 6: Tests

- [ ] Update integration tests for current flow
- [ ] Test claim/unclaim patterns
- [ ] Verify queue routing
- [ ] Test email parsing
- [ ] Check error handling

## Code Locations to Check

```
src/
├── main.ts                    # NestJS bootstrap
├── app.module.ts             # Module configuration
├── controllers/
│   └── health.controller.ts  # Keep health check only
├── services/
│   ├── email.service.ts      # Email parsing
│   ├── queue.service.ts      # Queue management
│   ├── container.service.ts  # Container lifecycle
│   └── dynamo.service.ts     # State management
└── consumers/
    └── email.consumer.ts      # SQS message handler
```

## Configuration to Review

```typescript
// Ensure these are correct
{
  queues: {
    email: 'webordinary-email-queue',
    unclaimed: 'webordinary-unclaimed-queue',
    dlq: 'webordinary-email-dlq'
  },
  tables: {
    threadMappings: 'webordinary-thread-mappings',
    containers: 'webordinary-containers',
    sessions: 'webordinary-edit-sessions'
  }
}
```

## Message Flow to Verify

1. Email arrives in SQS queue
2. Parse email for session/project/user
3. Look up or create thread mapping
4. Check if project+user has active claim
5. Send WorkMessage to project+user queue
6. If no claim, also send ClaimRequest to unclaimed
7. Handle response messages from containers

## Testing Commands

```bash
# Run integration tests
AWS_PROFILE=personal npm run test:integration

# Test email processing
AWS_PROFILE=personal npm run test:e2e

# Check health endpoint
curl http://localhost:3000/hermes/health

# Monitor logs
AWS_PROFILE=personal aws logs tail /ecs/hermes --since 5m
```

## DynamoDB Queries to Test

```bash
# Check thread mappings
AWS_PROFILE=personal aws dynamodb scan \
  --table-name webordinary-thread-mappings \
  --limit 5

# Check container claims
AWS_PROFILE=personal aws dynamodb scan \
  --table-name webordinary-containers \
  --limit 5

# Verify session state
AWS_PROFILE=personal aws dynamodb scan \
  --table-name webordinary-edit-sessions \
  --limit 5
```

## Success Criteria

- [ ] Clear project+user claiming
- [ ] Proper unclaimed queue handling
- [ ] Email → Queue routing works
- [ ] Only health endpoint exposed
- [ ] All tests passing
- [ ] Documentation updated

## Dependencies to Review

```json
{
  "keep": [
    "@nestjs/common",
    "@ssut/nestjs-sqs",
    "aws-sdk",
    "@aws-sdk/client-dynamodb",
    "@aws-sdk/client-sqs",
    "@aws-sdk/client-ecs"
  ],
  "verify": [
    "express dependencies (if NestJS needs them)"
  ]
}
```