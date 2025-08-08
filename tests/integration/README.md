# Webordinary Integration Tests

Comprehensive integration testing infrastructure for the Webordinary live-editing platform, validating end-to-end workflows from email processing to live preview delivery.

## Overview

This test suite validates the complete system integration across AWS services:
- **ECS/Fargate**: Container orchestration and scaling
- **DynamoDB**: Session state management  
- **CloudWatch**: Metrics and auto-scaling triggers
- **ALB**: Load balancing and routing
- **EFS**: Persistent workspace storage

## Quick Start

### Prerequisites
- AWS CLI configured with `personal` profile
- Node.js 20+ installed
- Tasks 00-05 deployed and functional

### Installation
```bash
cd tests/integration
npm install
```

### Configuration
Set environment variables (or use defaults):
```bash
export AWS_REGION=us-west-2
export AWS_ACCOUNT_ID=942734823970
export ALB_ENDPOINT=https://webordinary-edit-alb-916355172.us-west-2.elb.amazonaws.com
export TEST_CLIENT_ID=integration-test-client
```

### Running Tests
```bash
# Run infrastructure validation
npm run test:integration

# Run specific test suites (when implemented)
npm run test:cold-start
npm run test:persistence  
npm run test:concurrency
npm run test:routing
npm run test:resilience

# Run with verbose output
npm test -- --verbose

# Run single test file
npm test scenarios/infrastructure-validation.test.ts
```

## Test Architecture

### Core Components

#### IntegrationTestHarness (`src/integration-test-harness.ts`)
Main test orchestration class providing:
- Session creation and lifecycle management
- Container readiness detection
- File system verification
- AWS service interaction
- Comprehensive cleanup

#### AWS Service Clients (`src/aws-service-clients.ts`)
Specialized clients for each AWS service:
- **ECSServiceClient**: Service scaling, task management
- **DynamoDBServiceClient**: Session CRUD operations
- **CloudWatchServiceClient**: Metrics publishing/retrieval
- **ALBServiceClient**: Health checks and routing

#### Test Data Manager (`src/test-data-manager.ts`)
- Generates realistic test scenarios
- Creates test workspaces and files
- Tracks test results and statistics
- Provides comprehensive reporting

### Test Configuration (`config/test-config.ts`)
Centralized configuration for:
- AWS service endpoints and credentials
- Timeout values and retry policies
- Test data prefixes and isolation
- Resource identifiers and ARNs

## Test Scenarios

### Infrastructure Validation ✅
**Status**: Implemented  
**Purpose**: Validates AWS service connectivity and test harness functionality  
**Runtime**: ~30 seconds  
**Cost**: $0 (no container scaling)

### Cold Start Session Flow (Task 07)
**Purpose**: End-to-end session creation from 0 containers  
**Validates**: Container scaling, session persistence, preview URL access  
**Expected Runtime**: <60 seconds  
**Expected Cost**: ~$0.10-0.15

### Session Persistence (Task 07)  
**Purpose**: Workspace continuity across container restarts  
**Validates**: EFS mounting, git history, file persistence  
**Expected Runtime**: <90 seconds  
**Expected Cost**: ~$0.15-0.25

### Concurrent Sessions (Task 07)
**Purpose**: Multi-user isolation and resource sharing  
**Validates**: Auto-scaling, workspace isolation, independent lifecycles  
**Expected Runtime**: <120 seconds  
**Expected Cost**: ~$0.25-0.50

### ALB Routing (Task 07)
**Purpose**: Path-based routing verification  
**Validates**: Service routing, WebSocket upgrades, health checks  
**Expected Runtime**: <45 seconds  
**Expected Cost**: ~$0.08-0.12

### Failure Recovery (Task 08)
**Purpose**: Graceful error handling and recovery  
**Validates**: Container restart, orphan cleanup, data consistency  
**Expected Runtime**: <180 seconds  
**Expected Cost**: ~$0.30-0.60

## Development Workflow

### Adding New Tests

1. **Create test file** in `scenarios/` directory:
```typescript
describe('My New Test', () => {
  test('should do something', async () => {
    const session = await global.testHarness.createTestSession({
      userId: 'test@example.com',
      instruction: 'Create a test component'
    });
    
    await global.testHarness.waitForContainerReady(session.sessionId);
    await global.testHarness.verifyFileExists(session.sessionId, '/path/to/file');
  });
});
```

2. **Use test utilities**:
```typescript
import { testUtils } from '../src/setup-tests.js';

// Retry with backoff
await testUtils.retry(() => checkCondition(), 3);

// Wait for condition
await testUtils.waitForCondition(() => isReady(), 30000);

// Generate unique identifiers
const testId = testUtils.generateUniqueId('scenario');
```

3. **Leverage AWS service clients**:
```typescript
// Check service status
const status = await global.awsServices.ecs.getServiceStatus('my-service');

// Create test session in DynamoDB  
const session = await global.awsServices.dynamo.createSession(sessionData);

// Publish metrics
await global.awsServices.cloudWatch.publishTestMetrics('MyTest', {
  duration: 5000,
  success: true
});
```

### Best Practices

- **Isolation**: Use `TEST_` prefixed session IDs
- **Cleanup**: Always clean up resources in `afterEach`/`afterAll`
- **Timeouts**: Set appropriate timeouts for container operations
- **Idempotency**: Tests should be runnable multiple times
- **Logging**: Use descriptive console output for debugging

### Debugging Failed Tests

1. **Check AWS service health**:
```bash
npm run test -- --testNamePattern="AWS Service Connectivity"
```

2. **Verify configuration**:
```bash
npm run test -- --testNamePattern="Configuration Validation"
```

3. **Review service logs**:
```bash
aws logs tail /ecs/hermes --follow --profile personal
aws logs tail /ecs/edit --follow --profile personal
```

4. **Check DynamoDB sessions**:
```bash
aws dynamodb scan --table-name webordinary-edit-sessions --profile personal
```

## Cost Management

### Cost Estimation
- **Infrastructure validation**: $0 (no scaling)
- **Single integration test**: $0.10-0.25
- **Full test suite**: $1-3  
- **Daily CI/CD**: $30-90/month

### Cost Optimization
- Tests run sequentially to minimize concurrent containers
- Automatic cleanup after each test
- Services scale to zero when idle
- Test data uses TTL for automatic expiration

### Monitoring Costs
```bash
# Check current month costs
aws ce get-cost-and-usage --time-period Start=2024-12-01,End=2024-12-31 --granularity MONTHLY --metrics BlendedCost --group-by Type=DIMENSION,Key=SERVICE --profile personal
```

## CI/CD Integration

### GitHub Actions (Task 09)
```yaml
- name: Run integration tests
  run: |
    cd tests/integration
    npm ci
    npm run test:integration
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

### Test Result Artifacts
- JUnit XML: `results/test-results.xml`
- Coverage report: `results/coverage/`
- Performance metrics: Published to CloudWatch

## Troubleshooting

### Common Issues

**"Container not ready" timeout**
- Check ECS service has capacity
- Verify ECR image exists and is recent
- Review container logs for startup errors

**"Session not found" in DynamoDB**
- Verify IAM permissions for test execution
- Check DynamoDB table exists and is active
- Ensure test prefix configuration is correct

**"Service unhealthy" errors**
- Run infrastructure validation test first
- Check AWS service limits and quotas
- Verify VPC and security group configuration

### Getting Help

1. Run infrastructure validation: `npm run test -- --testNamePattern="Infrastructure"`
2. Check service health: View CloudWatch dashboards
3. Review logs: Use AWS CLI or Console
4. File issues: Include test output and service logs

## Next Steps

- **Task 07**: Implement core integration test scenarios
- **Task 08**: Add resilience and performance testing
- **Task 09**: CI/CD integration and monitoring
- **Task 10**: Documentation and optimization

---

**Task 06 Status**: ✅ **COMPLETE**  
**Infrastructure Ready**: All components implemented and validated  
**Next Step**: Proceed with Task 07 core integration test scenarios