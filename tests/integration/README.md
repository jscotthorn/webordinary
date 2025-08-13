# WebOrdinary Test Suites

Comprehensive testing for the S3-based WebOrdinary architecture, covering unit, integration, and end-to-end scenarios.

## 🏗️ Test Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Test Structure                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  /tests/                                                     │
│  ├── /e2e/                 # End-to-end tests               │
│  │   ├── email-to-s3-flow.e2e.ts                           │
│  │   ├── multi-user-scenarios.e2e.ts                       │
│  │   └── interrupt-and-git.e2e.ts                          │
│  │                                                           │
│  ├── /integration/         # Integration tests              │
│  │   ├── /scenarios/       # Test scenarios                 │
│  │   │   ├── queue-based-flow.test.ts                      │
│  │   │   ├── 04-s3-deployment.test.ts                      │
│  │   │   └── infrastructure-validation.test.ts             │
│  │   └── /src/             # Test utilities                 │
│  │                                                           │
│  ├── /unit/                # Component unit tests           │
│  │   ├── /hermes/          # Hermes service tests          │
│  │   └── /container/       # Container tests               │
│  │                                                           │
│  └── /mocks/               # Shared mock services          │
│      └── s3-architecture.mocks.ts                           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 📋 Test Coverage

### Unit Tests
- Message routing logic
- Queue processing
- Email parsing
- Git operations
- S3 sync operations
- Error handling

### Integration Tests
- Queue-based message flow
- S3 deployment verification
- Container claiming patterns
- Multi-session handling
- Infrastructure validation

### E2E Tests
- Complete email to S3 flow
- Multi-user scenarios
- Interrupt handling
- Git branch management
- Performance benchmarks

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- AWS credentials configured
- Running AWS services (or LocalStack)

### Setup

```bash
# Install dependencies
npm install

# Create test configuration
cp .env.test.example .env.test

# Configure AWS credentials
export AWS_PROFILE=personal
```

### Environment Configuration

Create `.env.test`:
```bash
# AWS Configuration
AWS_REGION=us-west-2
AWS_ACCOUNT_ID=942734823970

# Test Configuration
TEST_CLIENT_ID=test
TEST_USER_EMAIL=test@example.com
TEST_TIMEOUT=120000

# Service Endpoints
EMAIL_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-queue
UNCLAIMED_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed

# S3 Test Buckets
TEST_S3_BUCKET=edit.test.webordinary.com
AMELIA_S3_BUCKET=edit.amelia.webordinary.com

# DynamoDB Tables
THREAD_MAPPINGS_TABLE=webordinary-thread-mappings
CONTAINER_OWNERSHIP_TABLE=webordinary-container-ownership
```

## 🧪 Running Tests

### All Tests
```bash
# Run everything
npm test

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Unit Tests
```bash
# All unit tests
npm run test:unit

# Specific component
npm run test:unit -- hermes
npm run test:unit -- container
```

### Integration Tests
```bash
# All integration tests
AWS_PROFILE=personal npm run test:integration

# Specific scenario
AWS_PROFILE=personal npm test -- queue-based-flow
AWS_PROFILE=personal npm test -- s3-deployment
```

### E2E Tests
```bash
# All E2E tests (takes 5-10 minutes)
AWS_PROFILE=personal npm run test:e2e

# Specific flow
AWS_PROFILE=personal npm test -- email-to-s3
AWS_PROFILE=personal npm test -- multi-user
```

## 📊 Test Scenarios

### Queue-Based Flow
Tests the complete message routing through SQS:
```typescript
describe('Queue-Based Communication Flow', () => {
  test('should route email through queues to container and deploy')
  test('should claim project from unclaimed queue')
  test('should process instruction and return response')
});
```

### S3 Deployment
Verifies static site deployment:
```typescript
describe('S3 Deployment Verification', () => {
  test('should deploy to S3 after container processing')
  test('should update S3 on subsequent changes')
  test('should deploy all static assets')
  test('should handle build failures gracefully')
});
```

### Multi-User Scenarios
Tests concurrent usage patterns:
```typescript
describe('Multi-User Scenarios', () => {
  test('should handle multiple users on same project')
  test('should handle single user on multiple projects')
  test('should scale containers based on load')
  test('should maintain separate git branches')
});
```

### Interrupt Handling
Validates recovery mechanisms:
```typescript
describe('Interrupt and Recovery', () => {
  test('should handle interrupt mid-execution')
  test('should recover from container crash')
  test('should preserve commit history')
  test('should retry failed messages')
});
```

## 🔧 Test Utilities

### Mock Services
```typescript
import { createMockEnvironment } from './mocks/s3-architecture.mocks';

const mockEnv = createMockEnvironment();
// Use mockEnv.sqs, mockEnv.s3, mockEnv.dynamodb
```

### Test Data Manager
```typescript
import { TestDataManager } from './src/test-data-manager';

const testData = new TestDataManager();
const session = testData.generateSessionParams();
const instruction = testData.generateTestInstruction('complex');
```

### AWS Service Helpers
```typescript
import { awsServices } from './src/aws-services';

// Check container status
const status = await awsServices.ecs.getServiceStatus('edit-service');

// Verify S3 deployment
const deployed = await awsServices.s3.checkDeployment('edit.test.webordinary.com');
```

## 📈 Performance Benchmarks

### Target Metrics
| Operation | Target | Actual |
|-----------|--------|--------|
| Email → Routing | < 15s | ~10s |
| Routing → Processing | < 30s | ~20s |
| Processing → S3 | < 60s | ~45s |
| Total E2E | < 2 min | ~90s |
| Container Scale | < 45s | ~30s |

### Load Testing
```bash
# Run load tests
npm run test:load

# Concurrent users test
npm run test:load -- concurrent-users

# Message throughput test
npm run test:load -- throughput
```

## 🔄 Test Patterns

### Current Architecture Tests
```typescript
// Queue-based processing
test('should process message via SQS', async () => {
  await sqsClient.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(message)
  }));
  
  const result = await waitForProcessing();
  expect(result.success).toBe(true);
});

// S3 deployment verification
test('should deploy to S3', async () => {
  await processMessage(instruction);
  
  const deployed = await s3Client.send(new HeadObjectCommand({
    Bucket: 'edit.test.webordinary.com',
    Key: 'index.html'
  }));
  
  expect(deployed.LastModified).toBeDefined();
});
```

### Removed Legacy Tests
```typescript
// ❌ HTTP endpoint tests (removed)
test.skip('should respond on port 8080')

// ❌ ALB routing tests (removed)
test.skip('should route via load balancer')

// ❌ WebSocket tests (removed)
test.skip('should establish WebSocket connection')
```

## 🚨 Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| AWS credentials error | Set `AWS_PROFILE=personal` |
| Timeout errors | Increase `TEST_TIMEOUT` in .env.test |
| S3 access denied | Check bucket permissions |
| Queue not found | Verify queue URLs in config |
| DynamoDB errors | Check table names and region |

### Debug Mode
```bash
# Enable verbose logging
DEBUG=* npm test

# Run single test with logs
DEBUG=test:* npm test -- --testNamePattern="should deploy to S3"

# View AWS SDK calls
AWS_SDK_LOAD_CONFIG=1 DEBUG=aws-sdk:* npm test
```

## 📊 Test Reports

### Coverage Report
```bash
# Generate coverage
npm run test:coverage

# View HTML report
open coverage/index.html
```

### Test Results
```bash
# JSON output
npm test -- --json > test-results.json

# JUnit format (for CI)
npm test -- --reporters=jest-junit
```

## 🔐 Test Data Management

### Cleanup Strategy
- All test data uses unique IDs (UUIDs)
- Automatic cleanup in `afterAll()` hooks
- Manual cleanup script: `npm run test:cleanup`

### Test Isolation
- Each test uses unique thread IDs
- Separate S3 test bucket
- Time-based test prefixes
- No production data access

## 📚 Writing New Tests

### Test Structure
```typescript
describe('Feature Name', () => {
  let testResources: any;
  
  beforeAll(async () => {
    // Setup test environment
    testResources = await setupTestEnvironment();
  });
  
  afterAll(async () => {
    // Cleanup
    await cleanupTestResources(testResources);
  });
  
  test('should perform expected behavior', async () => {
    // Arrange
    const input = createTestInput();
    
    // Act
    const result = await performAction(input);
    
    // Assert
    expect(result).toMatchExpectedOutput();
  });
});
```

### Best Practices
1. Use descriptive test names
2. One assertion per test when possible
3. Clean up resources after tests
4. Use mocks for external services
5. Test error cases explicitly
6. Keep tests independent
7. Use timeouts appropriately

## 🚀 CI/CD Integration

### GitHub Actions
```yaml
name: Test Suite
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npm test
      - run: npm run test:e2e
```

### Pre-commit Hooks
```bash
# Install hooks
npm run prepare

# Runs before commit:
# - Unit tests
# - Linting
# - Type checking
```

## 📈 Monitoring Test Health

### Metrics to Track
- Test execution time
- Flaky test frequency
- Coverage percentage
- Failed test patterns
- Resource cleanup success

### Test Maintenance
- Review failing tests weekly
- Update mocks when APIs change
- Refactor slow tests
- Remove obsolete tests
- Add tests for new features

## 📝 License

Proprietary - WebOrdinary 2024

---

For contributing guidelines, see [CONTRIBUTING.md](../CONTRIBUTING.md)