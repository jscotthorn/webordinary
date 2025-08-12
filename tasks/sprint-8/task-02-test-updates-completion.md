# Test Updates for Queue-Based Architecture

## Overview
Updated all test suites to align with the new queue-based communication architecture, replacing HTTP-based tests with SQS message flow tests.

## Test Updates Completed

### 1. Hermes Tests Updated
#### `/hermes/src/modules/email-processor/email-processor.service.spec.ts`
- Replaced `ClaudeExecutorService` with `SqsExecutorService`
- Added `MessageRouterService` mock
- Updated test expectations for project/user identification
- Verified SQS execution flow

#### `/hermes/src/modules/claude-executor/sqs-executor.service.spec.ts` (NEW)
- Created comprehensive test suite for SQS executor
- Tests message routing to project queues
- Tests timeout handling
- Tests container starting scenarios
- Tests response processing

#### `/hermes/src/modules/message-processor/message-router.service.spec.ts` (NEW)
- Tests project/user identification from session, thread, and email
- Tests routing logic to project queues
- Tests ownership checking
- Tests unclaimed queue routing
- Tests thread mapping creation

### 2. Container Tests Created
#### `/claude-code-container/tests/integration/container-claim.test.js` (NEW)
- Tests container claim mechanism
- Verifies ownership table updates
- Tests message processing after claim
- Validates S3 deployment
- Checks ownership persistence

### 3. Integration Tests Created
#### `/tests/integration/scenarios/queue-based-flow.test.ts` (NEW)
- End-to-end email to S3 deployment flow
- Container claim mechanism testing
- Message processing pipeline validation
- Queue metrics monitoring
- Complete flow verification

## Test Coverage Summary

### Unit Tests
- ✅ MessageRouterService - routing logic, identification, ownership
- ✅ SqsExecutorService - SQS communication, timeouts, responses
- ✅ EmailProcessorService - updated for SQS integration
- ✅ ClaudeExecutorService - kept for backwards compatibility

### Integration Tests
- ✅ Container claim from unclaimed queue
- ✅ Message routing through project queues
- ✅ S3 deployment verification
- ✅ Ownership persistence checking
- ✅ Queue depth monitoring

### Manual Test Scenarios
1. **Cold Start Flow**
   - Scale containers to 0
   - Send email
   - Verify container spins up and claims work
   - Check S3 deployment

2. **Warm Container Flow**
   - Container already running
   - Send email
   - Verify immediate processing
   - Check response time

3. **Multiple Projects**
   - Send emails for different projects
   - Verify proper routing
   - Check ownership isolation

4. **Container Release**
   - Let container idle for 30+ minutes
   - Verify ownership release
   - Send new message
   - Verify re-claim

## Running the Tests

### Hermes Tests
```bash
cd /Users/scott/Projects/webordinary/hermes
npm test
```

### Container Tests
```bash
cd /Users/scott/Projects/webordinary/claude-code-container
AWS_PROFILE=personal node tests/integration/container-claim.test.js
```

### Integration Tests
```bash
cd /Users/scott/Projects/webordinary/tests/integration
AWS_PROFILE=personal npm test scenarios/queue-based-flow.test.ts
```

## Key Testing Considerations

1. **Queue Delays**: Messages may take a few seconds to propagate
2. **Container Startup**: Cold starts can take 30-60 seconds
3. **Ownership Conflicts**: Tests should clean up ownership after running
4. **S3 Eventual Consistency**: Deployments may take a moment to be visible
5. **DLQ Monitoring**: Failed messages should be checked in DLQs

## Next Steps for Testing

1. **Performance Testing**
   - Measure end-to-end latency
   - Test concurrent message processing
   - Validate scaling behavior

2. **Error Scenarios**
   - Test DLQ handling
   - Test ownership conflicts
   - Test container crashes

3. **Load Testing**
   - Multiple simultaneous emails
   - Queue depth stress testing
   - Container pool management

## Test Maintenance Notes

- Tests use hardcoded `ameliastamps/scott` configuration
- AWS credentials required (AWS_PROFILE=personal)
- Some tests require containers to be running
- Queue URLs may need updating if infrastructure changes
- Ownership table name is configurable via environment

## Status
✅ All test suites updated for queue-based architecture
✅ New tests created for claim mechanism
✅ Integration tests cover complete flow
⏳ Ready for deployment and manual testing