# Task 22: Integration Testing for Session Resumption

## Objective
Create comprehensive integration tests for the session resumption functionality implemented in Task 21, covering unit tests, API tests, ALB routing tests, and end-to-end scenarios.

## Requirements

### Test Coverage Areas
1. **Hermes API Integration Tests**
   - Session resumption endpoint (`/api/sessions/resume-preview`)
   - Container wake/sleep state management
   - DynamoDB session and container tracking
   - Error handling and edge cases

2. **ALB Lambda Integration Tests**
   - Container wake triggering via preview URLs
   - Session routing with container discovery
   - WebSocket routing limitations
   - Error responses and user experience

3. **Container Auto-Sleep Integration Tests**
   - Activity tracking and idle detection
   - Graceful shutdown with git auto-save
   - Container state transitions
   - Session counting and sleep decisions

4. **End-to-End Integration Tests**
   - Complete wake/sleep cycle validation
   - Performance and reliability testing
   - Concurrent request handling
   - AWS service integration validation

## Implementation

### Test Infrastructure Enhancement

#### Enhanced Integration Test Harness
**Location**: `tests/integration/src/integration-test-harness.ts`

**New Methods Added**:
```typescript
// Container state management
async setContainerStatus(containerId, status, additionalData?)
async getContainerStatus(containerId)
async waitForContainerStatus(containerId, targetStatus, timeout)

// Session resumption testing
async createResumptionTestSession(params)
async testHermesSessionResumption(threadId, clientId)
async testALBSessionRouting(threadId, clientId)
async simulateContainerAutoSleep(containerId)

// Thread mapping management
async createThreadMapping(sessionId, threadId, containerId)
async getActiveSessionCount(containerId)
```

#### Session Resumption Test Scenario
**Location**: `tests/integration/scenarios/05-session-resumption.test.ts`

**Test Categories**:
1. **Container Wake via Hermes API**
   - Stopped container wake functionality
   - Running container fast response
   - Session not found error handling
   - Performance metrics collection

2. **ALB Routing with Container Wake**
   - Preview URL container wake triggering
   - Session routing error scenarios
   - WebSocket limitation handling
   - User-friendly loading pages

3. **Container Auto-Sleep Simulation**
   - Idle state transition testing
   - Session count-based sleep decisions
   - Wake after sleep functionality

4. **Performance and Reliability**
   - Concurrent wake request handling
   - End-to-end performance measurement
   - Error recovery testing

### Unit Test Suites

#### Hermes SessionResumptionService Tests
**Location**: `hermes/src/modules/edit-session/services/session-resumption.service.spec.ts`

**Test Coverage**:
- Container state detection and transitions
- Fargate task management integration
- DynamoDB session and container operations
- Error handling and timeout scenarios
- Concurrent request handling

#### EditSessionController API Tests
**Location**: `hermes/src/modules/edit-session/controllers/edit-session.controller.integration.spec.ts`

**Test Coverage**:
- Resume-preview endpoint functionality
- Request validation and error responses
- Service integration and error handling
- Performance under load

#### ALB Lambda Router Tests
**Location**: `hephaestus/lambdas/session-router/test/integration.test.ts`

**Test Coverage**:
- Session routing with container wake
- DynamoDB lookup operations
- Hermes API integration
- Error response handling
- Path and client ID extraction

#### Container AutoSleepService Tests  
**Location**: `claude-code-container/src/services/auto-sleep.service.integration.spec.ts`

**Test Coverage**:
- Activity tracking and idle detection
- Container lifecycle management
- Git auto-save functionality
- DynamoDB state updates
- Session counting logic

## Test Configuration and Execution

### Test Runner Configuration
**Location**: `tests/integration/package.json`

**New Script Added**:
```json
"test:resumption": "jest scenarios/05-session-resumption.test.ts"
```

### Environment Setup
```bash
# Required environment variables
export AWS_REGION=us-west-2
export AWS_PROFILE=personal
export RUN_INTEGRATION_TESTS=true

# Optional configuration
export HERMES_API_URL=https://your-hermes-endpoint
export ALB_DNS_NAME=your-alb-dns-name
export INTERNAL_API_KEY=your-api-key
```

### Test Execution Commands
```bash
# Unit tests (mocked)
cd tests/integration
npm run test:resumption

# Integration tests (real AWS)
RUN_INTEGRATION_TESTS=true npm run test:resumption

# All session resumption tests
npm run test:all
```

## Performance Metrics Collected

### Key Metrics
- **Container Wake Time**: Target < 60 seconds
- **API Response Time**: Target < 2 seconds for running containers  
- **Success Rate**: Wake requests and routing success
- **Concurrent Handling**: Multi-request performance
- **Error Recovery**: Graceful failure handling

### Test Output Format
```
📊 Session Resumption Test Metrics:
   Container Wake Time: avg 23450ms
   API Response Time: avg 245ms
   Successful Wakes: 8
   Total Errors: 0
```

## Infrastructure Dependencies

### AWS Resources Required
- **DynamoDB Tables**: 
  - `webordinary-edit-sessions`
  - `webordinary-thread-mappings`  
  - `webordinary-containers`
- **ECS Resources**:
  - `webordinary-edit-cluster`
  - `webordinary-edit-service`
- **ALB Configuration**: Session routing Lambda deployed

### Code Dependencies
- Enhanced EditSession interface with `containerId` field
- Session resumption service in Hermes
- Auto-sleep service in containers
- Updated ALB routing Lambda

## Success Criteria
- [ ] All unit tests pass with >90% code coverage
- [ ] Integration tests validate AWS service interactions
- [ ] End-to-end tests confirm complete wake/sleep cycles
- [ ] Performance tests meet response time targets
- [ ] Error scenarios return appropriate status codes
- [ ] Concurrent requests handled gracefully
- [ ] Documentation covers test execution procedures

## Known Issues and Limitations

### Current Issues
1. **Jest ESM Configuration**: Node-fetch import issues in integration tests
2. **Mock Type Safety**: TypeScript strict mode issues with AWS SDK mocks
3. **Container Dependencies**: Tests require real containers for full validation
4. **Network Timeout Handling**: Fetch timeout implementation differences

### WebSocket Limitations
- ALB Lambda targets cannot handle WebSocket upgrades
- Tests validate appropriate 502 error responses
- Future enhancement needed for WebSocket session routing

## Next Steps
1. **Fix Jest Configuration**: Resolve ESM import issues for integration tests
2. **Complete Unit Test Mocking**: Fix TypeScript type issues in service tests
3. **Container Test Dependencies**: Add test container build process
4. **CI/CD Integration**: Add tests to automated pipeline
5. **Performance Benchmarking**: Establish baseline metrics and alerts

## Documentation
- **Test Execution Guide**: `tests/integration/SESSION_RESUMPTION_TESTING.md`
- **Test Architecture**: Comprehensive coverage strategy documented
- **Troubleshooting Guide**: Common issues and solutions provided