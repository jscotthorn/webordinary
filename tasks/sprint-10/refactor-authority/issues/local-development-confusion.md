# Local Development Configuration Issues

## Problem Summary

The recent attempt to add local development support has introduced confusion about message formats and mixed test data with production queues. This is causing messages to fail and end up in the DLQ.

## Evidence

### DLQ Analysis
From `dlq-messages-all.json`, we see two distinct message types:

#### Valid Production Messages (from escottster@gmail.com)
```json
{
  "messageId": "87a8b094-f26b-4d61-a2a2-a553b23df3d5",
  "timestamp": "2025-08-10T14:50:55.599Z",
  "from": "escottster@gmail.com",
  "to": ["buddy@webordinary.com"],
  "subject": "Test change",
  "instruction": "Change \"Welcome to My Site\" on the home page to \"Amelia Stamps Pottery\""
}
```

#### Invalid Test Messages (from local development)
```json
{
  "messageId": "a30fe5f3-9076-4eb7-b44b-3ddae3148042",
  "timestamp": "unknown",
  "from": "unknown",
  "to": [],
  "subject": "no subject",
  "instruction": "No content field"
}
```

## Root Causes

### 1. Message Format Mismatch
- **Production**: SES wraps emails in specific format
- **Local Dev**: Attempting to send raw messages without SES wrapper
- **Hermes**: Expects SES format, fails on raw messages

### 2. Shared Queue Usage
- **Problem**: Local dev using same SQS queues as production
- **Risk**: Test data contaminating production flow
- **Evidence**: Mixed messages in DLQ

### 3. Docker Compose Configuration
- **Current**: Points to real AWS services
- **Issue**: No separation between local and production
- **Missing**: Local queue simulation or separate test queues

## Solutions Required

### Option 1: Separate Test Queues (Recommended)
Create dedicated queues for local development:
```
webordinary-email-queue-dev
webordinary-unclaimed-queue-dev
webordinary-email-dlq-dev
```

Benefits:
- Complete isolation from production
- Safe for testing
- Can be purged without risk

Implementation:
1. Create dev queues in AWS
2. Update `.env.local` to use dev queues
3. Configure Hermes to select queues based on NODE_ENV

### Option 2: Local Message Format Adapter
Create adapter in Hermes to handle both formats:

```typescript
interface RawMessage {
  from: string;
  to: string[];
  subject: string;
  body: string;
}

interface SESMessage {
  Message: string; // JSON string containing mail object
  MessageId: string;
  // ... other SES fields
}

function normalizeMessage(input: any): ParsedEmail {
  if (input.Message) {
    // SES format - parse the wrapped message
    return parseSESMessage(input);
  } else if (input.from && input.to) {
    // Raw format - use directly
    return parseRawMessage(input);
  }
  throw new Error('Unknown message format');
}
```

### Option 3: LocalStack Integration
Use LocalStack for complete local AWS simulation:

```yaml
# docker-compose.local.yml
localstack:
  image: localstack/localstack:latest
  environment:
    - SERVICES=sqs,dynamodb,s3,ses
  ports:
    - "4566:4566"
```

Benefits:
- Complete isolation
- No AWS costs
- Realistic testing

Drawbacks:
- More complex setup
- May not perfectly match AWS behavior

## Message Schema Documentation

### Production (SES → SQS)
```typescript
interface SESMessage {
  Type: 'Notification';
  MessageId: string;
  TopicArn: string;
  Message: string; // JSON string containing:
  // {
  //   notificationType: 'Received';
  //   mail: {
  //     messageId: string;
  //     source: string;
  //     destination: string[];
  //     headers: Array<{name: string, value: string}>;
  //     commonHeaders: {
  //       from: string[];
  //       to: string[];
  //       subject: string;
  //     };
  //   };
  //   content: string; // Raw email content
  // }
}
```

### Local Development (Direct)
```typescript
interface LocalTestMessage {
  from: string;
  to: string[];
  subject: string;
  body: string;
  threadId?: string;
  projectId?: string;
  userId?: string;
}
```

## Action Items

### Immediate (Fix Production)
1. [ ] Purge DLQ of invalid test messages
2. [ ] Update Hermes to handle message format errors gracefully
3. [ ] Add validation before processing

### Short Term (Local Dev Support)
1. [ ] Create separate dev queues
2. [ ] Update Docker Compose configuration
3. [ ] Add message format adapter in Hermes
4. [ ] Create local test data generator

### Long Term (Robust Local Dev)
1. [ ] Implement LocalStack option
2. [ ] Create development seed data
3. [ ] Add integration test suite for local dev
4. [ ] Document local development workflow

## Testing Strategy

### Unit Tests
- Test both message formats
- Test error handling
- Test queue selection logic

### Integration Tests
- Test with real AWS (dev queues)
- Test with LocalStack
- Test message flow end-to-end

### Manual Testing
1. Send test email to dev environment
2. Verify processing in Hermes
3. Check container receives correct format
4. Verify S3 deployment works

## Configuration Changes Needed

### hermes/.env.local
```bash
# Add environment-specific queue selection
NODE_ENV=development
EMAIL_QUEUE_SUFFIX=-dev  # Appended to queue names in dev
```

### claude-code-container/.env.local
```bash
# Ensure using dev queues
NODE_ENV=development
UNCLAIMED_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed-queue-dev
```

### Docker Compose
```yaml
hermes:
  environment:
    - NODE_ENV=development
    - USE_DEV_QUEUES=true
```

## Success Criteria

1. No test messages in production DLQ
2. Local dev can send test messages successfully
3. Hermes handles both message formats
4. Clear separation between dev and prod
5. Documentation explains message formats
6. Tests cover both scenarios