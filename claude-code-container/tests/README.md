# Claude Code Container Tests

This directory contains all tests for the Claude Code Container project, organized by type.

## Directory Structure

```
tests/
├── unit/           # Unit tests for individual components
├── integration/    # Integration tests for service interactions
├── e2e/           # End-to-end tests with real services
├── scripts/       # Tests for utility scripts
└── run-tests.js   # Main test runner
```

## Running Tests

### Using npm scripts (recommended)

```bash
# Show help
npm test

# Run all tests
npm run test:all

# Run specific test suite
npm run test:unit          # Unit tests
npm run test:integration   # Integration tests
npm run test:e2e          # End-to-end tests
npm run test:scripts      # Script tests

# Run specific test
npm run test:multi-session
npm run test:git-scenarios

# List all available tests
npm run test:list
```

### Using the test runner directly

```bash
# From the tests directory
node run-tests.js all
node run-tests.js integration
node run-tests.js multi-session
```

## Test Types

### Unit Tests (`unit/`)
- Component-level tests
- Mock dependencies
- Fast execution
- No external services

### Integration Tests (`integration/`)
- **container.test.js** - Container initialization and basic operations
- **multi-session.test.js** - Multi-session workflow scenarios
- **git-push.test.sh** - Git push functionality with GitHub
- **git-scenarios.test.sh** - Git conflict handling scenarios

### End-to-End Tests (`e2e/`)
- **local-container.test.sh** - Full container workflow locally
- Real AWS services
- Complete workflows
- Production-like environment

### Script Tests (`scripts/`)
- **git-ops.test.sh** - Git operations utilities
- **local-shell.test.sh** - Local shell execution
- **s3-sync.test.sh** - S3 synchronization
- **run-s3.test.sh** - S3 deployment scripts
- **monitor.sh** - System monitoring utilities

## Test Scenarios

### Multi-Session Testing
Tests various session management scenarios:
1. Basic session flow
2. Session switching
3. Interrupt handling
4. Rapid switching
5. Concurrent users

Run with: `npm run test:multi-session`

### Git Conflict Testing
Tests git conflict resolution:
1. Safe branch switching with stashing
2. Automatic conflict resolution
3. Repository recovery
4. Stash management

Run with: `npm run test:git-scenarios`

## Monitoring Tests

Use the monitor script to watch test execution:

```bash
# Single check
./tests/scripts/monitor.sh

# Continuous monitoring
./tests/scripts/monitor.sh --watch
```

## Writing New Tests

### JavaScript Tests
Place in appropriate directory with `.test.js` extension:

```javascript
// tests/integration/my-test.test.js
const assert = require('assert');

// Test implementation
console.log('✅ Test passed');
process.exit(0);  // Success
process.exit(1);  // Failure
```

### Shell Script Tests
Place in appropriate directory with `.test.sh` extension:

```bash
#!/bin/bash
# tests/scripts/my-test.test.sh

echo "Running test..."
# Test implementation

if [ $? -eq 0 ]; then
    echo "✅ Test passed"
    exit 0
else
    echo "❌ Test failed"
    exit 1
fi
```

### Adding to Test Suite
Update `run-tests.js` to include new test:

```javascript
const testSuites = {
  integration: {
    files: [
      'existing-test.js',
      'my-new-test.test.js'  // Add here
    ]
  }
};
```

## Environment Variables

Tests may require these environment variables:

```bash
export AWS_PROFILE=personal
export AWS_REGION=us-west-2
export CLIENT_ID=ameliastamps
export GITHUB_TOKEN=your_token_here
export INPUT_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/...
```

## CI/CD Integration

For automated testing in CI/CD:

```yaml
# Example GitHub Actions
- name: Run Tests
  run: |
    npm install
    npm run test:all
```

## Troubleshooting

### Common Issues

1. **Permission denied**: Make shell scripts executable
   ```bash
   chmod +x tests/**/*.sh
   ```

2. **AWS credentials**: Ensure AWS_PROFILE is set
   ```bash
   export AWS_PROFILE=personal
   ```

3. **Missing dependencies**: Install required packages
   ```bash
   npm install
   ```

4. **Test not found**: Check file exists and is in suite configuration

## Test Coverage

Current coverage by component:

- ✅ Git operations (stashing, conflicts, push)
- ✅ Session management (switching, isolation)
- ✅ SQS message handling
- ✅ S3 deployment
- ✅ Container health checks
- ⚠️  Unit tests (pending implementation)
- ⚠️  Error recovery scenarios (partial)

## Future Improvements

- [ ] Add Jest unit tests for services
- [ ] Implement test coverage reporting
- [ ] Add performance benchmarks
- [ ] Create mock AWS services for faster testing
- [ ] Add automated regression tests
- [ ] Implement visual regression for S3 deployments