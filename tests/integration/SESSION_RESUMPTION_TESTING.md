# Session Resumption Integration Testing

This document describes the comprehensive integration test suite for the session resumption functionality implemented in Task 21.

## 🧪 Test Architecture

### Test Layers
1. **Unit Tests**: Individual service methods in Hermes and container
2. **Integration Tests**: Service interactions with AWS services
3. **API Tests**: Hermes endpoints with real/mock AWS
4. **Lambda Tests**: ALB router with Hermes API integration
5. **End-to-End Tests**: Complete session wake/sleep cycle

### Test Structure
```
tests/integration/
├── scenarios/05-session-resumption.test.ts  # Main test suite
├── src/integration-test-harness.ts          # Enhanced with resumption methods
└── config/test-config.ts                    # Updated configuration
```

## 🎯 Test Scenarios

### 1. Container Wake via Hermes API
- **Stopped Container Wake**: Tests API wake of stopped containers
- **Running Container Response**: Tests fast response for active containers
- **Session Not Found**: Tests graceful error handling
- **Performance Metrics**: Measures API response times and wake durations

### 2. ALB Routing with Container Wake
- **Preview URL Wake**: Tests ALB Lambda triggering container wake
- **Session Not Found**: Tests 404 responses for invalid sessions
- **WebSocket Limitations**: Tests WebSocket routing error handling
- **Container Starting Pages**: Tests user-friendly loading pages

### 3. Container Auto-Sleep Simulation
- **Idle State Transition**: Simulates container idle → stopping → stopped
- **Session Count Checking**: Tests active session counting logic
- **Wake After Sleep**: Tests containers can be woken after sleeping

### 4. Performance and Reliability
- **Concurrent Wake Requests**: Tests handling multiple simultaneous wakes
- **End-to-End Performance**: Measures complete wake cycle timing
- **Error Recovery**: Tests graceful handling of failures
- **Load Testing**: Tests system under concurrent load

## 🚀 Running the Tests

### Prerequisites
1. **AWS Resources**: DynamoDB tables, ECS cluster, ALB must be deployed
2. **Credentials**: AWS credentials configured via environment or profile
3. **Dependencies**: Install test dependencies

```bash
cd tests/integration
npm install
```

### Environment Variables
```bash
# Required
export AWS_REGION=us-west-2
export AWS_PROFILE=personal

# Optional (uses defaults if not set)
export ALB_ENDPOINT=https://your-alb-endpoint.elb.amazonaws.com
export HERMES_ENDPOINT=https://your-hermes-endpoint.com
export INTERNAL_API_KEY=your-api-key

# For actual AWS integration tests
export RUN_INTEGRATION_TESTS=true
```

### Test Execution Commands

#### Unit Tests (with mocks)
```bash
# Run session resumption unit tests
npm run test:resumption

# Run all unit tests
npm run test
```

#### Integration Tests (against real AWS)
```bash
# Infrastructure validation
npm run test:infrastructure

# Session resumption integration tests
RUN_INTEGRATION_TESTS=true npm run test:resumption

# All integration tests
RUN_INTEGRATION_TESTS=true npm run test:all
```

#### Individual Test Categories
```bash
# Test Hermes API only
npm run test -- --testNamePattern="Container Wake via Hermes API"

# Test ALB routing only
npm run test -- --testNamePattern="ALB Routing with Container Wake"

# Test performance scenarios
npm run test -- --testNamePattern="Performance and Reliability"
```

## 📊 Test Metrics and Reporting

### Performance Metrics Collected
- **Container Wake Time**: Time for stopped container to become running
- **API Response Time**: Hermes API response latency
- **ALB Routing Time**: End-to-end routing latency
- **Concurrent Request Handling**: Multi-request performance
- **Error Rates**: Success/failure ratios

### Test Output Example
```
📊 Session Resumption Test Metrics:
   Container Wake Time: avg 23450ms
   API Response Time: avg 245ms
   Successful Wakes: 8
   Total Errors: 0

✅ 05 - Session Resumption Integration Tests
   ✅ Container Wake via Hermes API
      ⏱️  Container wake time: 23450ms
      ⚡ Fast response time: 156ms
   ✅ ALB Routing with Container Wake
      🔄 Container wake triggered via ALB (3240ms)
      ✅ Request routed successfully (892ms)
   ✅ Container Auto-Sleep Simulation
      💤 Container transitioned to stopped state
      🔄 Container wake after sleep: starting
   ✅ Performance and Reliability
      ⚡ 3 concurrent requests handled in 4580ms
      📈 Performance metrics:
         API Response: 198ms
         Container Start: 22340ms
         Total Wake Time: 22538ms
```

## 🏗️ Test Data Management

### Automatic Test Data
The test harness automatically:
- Creates unique session IDs with timestamp prefixes
- Sets up DynamoDB session and container records
- Creates thread mappings for routing tests
- Cleans up test data after completion

### Manual Test Data Setup
For debugging or specific scenarios:

```typescript
// Create test session
const session = await testHarness.createTestSession({
  clientId: 'debugclient',
  userId: 'debug-user',
  instruction: 'Debug test session'
});

// Set container state
await testHarness.setContainerStatus(session.containerId, 'stopped');

// Test wake functionality
const result = await testHarness.testHermesSessionResumption(
  session.threadId, 
  session.clientId
);
```

## 🔧 Test Configuration

### AWS Service Configuration
Located in `config/test-config.ts`:

```typescript
export const TEST_CONFIG = {
  services: {
    clusterName: 'webordinary-edit-cluster',
    hermesService: 'webordinary-hermes-service',
    editService: 'webordinary-edit-service',
  },
  endpoints: {
    alb: 'https://your-alb-endpoint',
    hermes: 'https://your-hermes-endpoint',
  },
  timeouts: {
    containerReady: 60000,    // 1 minute
    sessionExpiry: 70000,     // 70 seconds
    testTimeout: 300000       // 5 minutes
  }
};
```

### Jest Configuration
- **Timeout**: 300 seconds for integration tests
- **Environment**: Node.js with ES modules
- **Setup**: Automatic AWS resource validation
- **Cleanup**: Automatic test data removal

## 🚨 Troubleshooting

### Common Issues

#### 1. AWS Resource Validation Failures
```bash
❌ AWS resource validation failed: Table webordinary-containers is not available
```
**Solution**: Ensure all DynamoDB tables are created and in ACTIVE state

#### 2. Container Wake Timeouts
```bash
Container test-container-123 did not reach status running within 60000ms
```
**Solution**: 
- Check ECS service capacity and scaling
- Verify container image is available
- Increase timeout for slower environments

#### 3. ALB Routing Failures
```bash
ALB routing test failed: ENOTFOUND edit.testclient.webordinary.com
```
**Solution**:
- Verify DNS configuration for edit subdomains
- Check ALB listener rules are properly configured
- Ensure SSL certificates cover wildcard domains

#### 4. Hermes API Connection Errors
```bash
Hermes API test failed: connect ECONNREFUSED
```
**Solution**:
- Verify Hermes service is deployed and running
- Check service health endpoint
- Validate API authentication tokens

### Debug Mode
Enable verbose logging:
```bash
DEBUG=webordinary:* npm run test:resumption
```

### Test Isolation
Run tests individually to isolate issues:
```bash
# Single test
npm run test -- --testNamePattern="should wake stopped container"

# Single test file
npm run test -- scenarios/05-session-resumption.test.ts
```

## 📝 Test Coverage

### Functional Coverage
- ✅ Container state transitions (stopped → starting → running)
- ✅ Session resumption via Hermes API
- ✅ ALB routing with container wake
- ✅ Error handling and graceful degradation
- ✅ WebSocket routing limitations
- ✅ Concurrent request handling
- ✅ Performance metrics collection

### Edge Cases Covered
- ✅ Session not found scenarios
- ✅ Container startup failures
- ✅ DynamoDB service unavailability
- ✅ Network timeouts and retries
- ✅ Malformed requests
- ✅ Concurrent wake requests

### Known Limitations
- 🔶 WebSocket routing requires manual target group management
- 🔶 Container IP registration relies on self-reporting
- 🔶 Real container startup times vary by environment
- 🔶 ECS service scaling limits may affect tests

## 🎯 Success Criteria

Tests pass when:
- ✅ Stopped containers can be woken via API calls
- ✅ Preview URLs trigger container wake through ALB
- ✅ Running containers respond quickly (< 2 seconds)
- ✅ Container wake completes within 60 seconds
- ✅ Error scenarios return appropriate status codes
- ✅ Concurrent requests are handled gracefully
- ✅ Performance metrics are within acceptable ranges

## 🔄 Continuous Integration

### CI/CD Pipeline Integration
```yaml
# Example GitHub Actions workflow
- name: Run Session Resumption Tests
  env:
    RUN_INTEGRATION_TESTS: true
    AWS_REGION: us-west-2
  run: |
    cd tests/integration
    npm ci
    npm run test:resumption
```

### Test Reporting
- **JUnit XML**: Generated for CI/CD integration
- **Coverage Reports**: Code coverage for test code itself
- **Performance Metrics**: Exported to CloudWatch for monitoring
- **Test Results**: Detailed logs for debugging failures

---

**The session resumption integration tests provide comprehensive coverage of the wake/sleep functionality, ensuring reliable container lifecycle management and optimal user experience.** 🚀