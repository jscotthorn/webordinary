# Task 07: CI/CD Integration

## Objective
Set up GitHub Actions workflow to run integration tests automatically, with proper reporting and notifications.

## Context
Need automated testing to:
- Run on every PR
- Schedule daily full test runs
- Generate test reports
- Notify on failures
- Track test metrics over time

## Implementation

### 1. GitHub Actions Workflow
```yaml
# .github/workflows/integration-tests.yml

name: Integration Tests

on:
  pull_request:
    branches: [main, develop]
    paths:
      - 'hermes/**'
      - 'claude-code-container/**'
      - 'hephaestus/**'
      - 'tests/integration/**'
  
  schedule:
    # Daily at 2 AM UTC
    - cron: '0 2 * * *'
  
  workflow_dispatch:
    inputs:
      test_suite:
        description: 'Test suite to run'
        required: false
        default: 'all'
        type: choice
        options:
          - all
          - s3-deployment
          - git-workflow
          - performance
          - error-recovery
      
      environment:
        description: 'Environment to test'
        required: false
        default: 'test'
        type: choice
        options:
          - test
          - staging

env:
  AWS_REGION: us-west-2
  NODE_VERSION: 18

jobs:
  setup:
    runs-on: ubuntu-latest
    outputs:
      test-matrix: ${{ steps.set-matrix.outputs.matrix }}
    steps:
      - uses: actions/checkout@v3
      
      - name: Set test matrix
        id: set-matrix
        run: |
          if [[ "${{ github.event.inputs.test_suite }}" == "all" || "${{ github.event_name }}" != "workflow_dispatch" ]]; then
            echo "matrix={\"suite\":[\"s3-deployment\",\"git-workflow\",\"performance\",\"error-recovery\",\"multi-session\"]}" >> $GITHUB_OUTPUT
          else
            echo "matrix={\"suite\":[\"${{ github.event.inputs.test_suite }}\"]}" >> $GITHUB_OUTPUT
          fi

  integration-tests:
    needs: setup
    runs-on: ubuntu-latest
    strategy:
      matrix: ${{ fromJson(needs.setup.outputs.test-matrix) }}
      fail-fast: false
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
          cache-dependency-path: tests/integration/package-lock.json
      
      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}
      
      - name: Install dependencies
        working-directory: tests/integration
        run: npm ci
      
      - name: Set environment variables
        run: |
          echo "TEST_ENVIRONMENT=${{ github.event.inputs.environment || 'test' }}" >> $GITHUB_ENV
          echo "GITHUB_TOKEN=${{ secrets.GITHUB_TOKEN }}" >> $GITHUB_ENV
          echo "INTERNAL_API_KEY=${{ secrets.INTERNAL_API_KEY }}" >> $GITHUB_ENV
      
      - name: Run ${{ matrix.suite }} tests
        working-directory: tests/integration
        run: |
          npm test -- --testNamePattern="${{ matrix.suite }}" \
            --json --outputFile=results/${{ matrix.suite }}-results.json \
            --coverage --coverageDirectory=coverage/${{ matrix.suite }}
        continue-on-error: true
      
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results-${{ matrix.suite }}
          path: |
            tests/integration/results/${{ matrix.suite }}-results.json
            tests/integration/coverage/${{ matrix.suite }}
      
      - name: Parse test results
        if: always()
        id: test-results
        working-directory: tests/integration
        run: |
          node scripts/parse-results.js results/${{ matrix.suite }}-results.json
          echo "passed=$(jq -r '.numPassedTests' results/${{ matrix.suite }}-results.json)" >> $GITHUB_OUTPUT
          echo "failed=$(jq -r '.numFailedTests' results/${{ matrix.suite }}-results.json)" >> $GITHUB_OUTPUT
          echo "total=$(jq -r '.numTotalTests' results/${{ matrix.suite }}-results.json)" >> $GITHUB_OUTPUT
      
      - name: Comment PR
        if: github.event_name == 'pull_request' && always()
        uses: actions/github-script@v6
        with:
          script: |
            const suite = '${{ matrix.suite }}';
            const passed = ${{ steps.test-results.outputs.passed }};
            const failed = ${{ steps.test-results.outputs.failed }};
            const total = ${{ steps.test-results.outputs.total }};
            
            const status = failed === 0 ? '✅' : '❌';
            const message = `${status} **${suite}**: ${passed}/${total} tests passed`;
            
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: message
            });

  performance-report:
    needs: integration-tests
    if: contains(fromJson(needs.setup.outputs.test-matrix).suite, 'performance')
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Download performance results
        uses: actions/download-artifact@v3
        with:
          name: test-results-performance
          path: test-results
      
      - name: Generate performance report
        run: |
          node tests/integration/scripts/generate-performance-report.js \
            test-results/performance-results.json \
            > performance-report.md
      
      - name: Upload to S3
        run: |
          TIMESTAMP=$(date +%Y%m%d-%H%M%S)
          aws s3 cp performance-report.md \
            s3://webordinary-test-reports/performance/${TIMESTAMP}-report.md
      
      - name: Publish metrics to CloudWatch
        run: |
          node tests/integration/scripts/publish-metrics.js \
            test-results/performance-results.json

  test-summary:
    needs: integration-tests
    if: always()
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Download all test results
        uses: actions/download-artifact@v3
        with:
          path: test-results
      
      - name: Generate summary
        run: |
          echo "## Integration Test Summary" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "| Test Suite | Status | Tests Passed | Coverage |" >> $GITHUB_STEP_SUMMARY
          echo "|------------|--------|--------------|----------|" >> $GITHUB_STEP_SUMMARY
          
          for dir in test-results/test-results-*; do
            suite=$(basename $dir | sed 's/test-results-//')
            if [ -f "$dir/${suite}-results.json" ]; then
              passed=$(jq -r '.numPassedTests' "$dir/${suite}-results.json")
              total=$(jq -r '.numTotalTests' "$dir/${suite}-results.json")
              failed=$(jq -r '.numFailedTests' "$dir/${suite}-results.json")
              
              if [ "$failed" -eq 0 ]; then
                status="✅ Passed"
              else
                status="❌ Failed"
              fi
              
              coverage="N/A"
              if [ -f "$dir/coverage-summary.json" ]; then
                coverage=$(jq -r '.total.lines.pct' "$dir/coverage-summary.json")%
              fi
              
              echo "| $suite | $status | $passed/$total | $coverage |" >> $GITHUB_STEP_SUMMARY
            fi
          done
      
      - name: Send Slack notification
        if: failure() && github.event_name == 'schedule'
        uses: slackapi/slack-github-action@v1
        with:
          webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
          payload: |
            {
              "text": "Integration tests failed!",
              "attachments": [{
                "color": "danger",
                "title": "Daily Integration Test Failure",
                "text": "The scheduled integration tests have failed.",
                "fields": [
                  {
                    "title": "Repository",
                    "value": "${{ github.repository }}",
                    "short": true
                  },
                  {
                    "title": "Run URL",
                    "value": "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
                    "short": false
                  }
                ]
              }]
            }
```

### 2. Test Result Parser Script
```javascript
// tests/integration/scripts/parse-results.js

const fs = require('fs');

const resultsFile = process.argv[2];
if (!resultsFile) {
  console.error('Usage: node parse-results.js <results-file>');
  process.exit(1);
}

const results = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));

// Extract key metrics
const summary = {
  numPassedTests: results.numPassedTests || 0,
  numFailedTests: results.numFailedTests || 0,
  numTotalTests: results.numTotalTests || 0,
  testResults: []
};

// Process test results
if (results.testResults) {
  results.testResults.forEach(suite => {
    suite.assertionResults?.forEach(test => {
      if (test.status === 'failed') {
        summary.testResults.push({
          suite: suite.name,
          test: test.title,
          error: test.failureMessages?.[0]
        });
      }
    });
  });
}

// Output summary
console.log(JSON.stringify(summary, null, 2));

// Set exit code based on failures
if (summary.numFailedTests > 0) {
  process.exit(1);
}
```

### 3. Performance Report Generator
```javascript
// tests/integration/scripts/generate-performance-report.js

const fs = require('fs');

const resultsFile = process.argv[2];
const results = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));

// Extract performance metrics from test output
const metrics = {};
results.testResults?.forEach(suite => {
  suite.assertionResults?.forEach(test => {
    if (test.title.includes('performance') || test.title.includes('benchmark')) {
      // Parse console output for metrics
      const output = test.failureMessages?.join('\n') || '';
      const matches = output.matchAll(/(\w+):\s*(\d+)ms/g);
      
      for (const match of matches) {
        const [, metric, value] = match;
        if (!metrics[metric]) {
          metrics[metric] = [];
        }
        metrics[metric].push(parseInt(value));
      }
    }
  });
});

// Generate markdown report
console.log('# Performance Test Report');
console.log(`\nGenerated: ${new Date().toISOString()}\n`);

console.log('## Metrics Summary\n');
console.log('| Metric | Average | Min | Max | P95 |');
console.log('|--------|---------|-----|-----|-----|');

Object.entries(metrics).forEach(([name, values]) => {
  if (values.length > 0) {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const p95 = percentile(values, 95);
    
    console.log(`| ${name} | ${Math.round(avg)}ms | ${min}ms | ${max}ms | ${Math.round(p95)}ms |`);
  }
});

console.log('\n## Performance Trends\n');
console.log('```mermaid');
console.log('graph LR');
console.log('  A[Email] -->|5s| B[SQS]');
console.log('  B -->|2s| C[Container]');
console.log('  C -->|30s| D[Claude]');
console.log('  D -->|45s| E[Build]');
console.log('  E -->|15s| F[S3]');
console.log('```');

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[index];
}
```

### 4. Metrics Publisher
```javascript
// tests/integration/scripts/publish-metrics.js

const AWS = require('aws-sdk');
const fs = require('fs');

const cloudwatch = new AWS.CloudWatch({ region: 'us-west-2' });
const resultsFile = process.argv[2];
const results = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));

async function publishMetrics() {
  const timestamp = new Date();
  const metricData = [];
  
  // Test pass/fail metrics
  metricData.push({
    MetricName: 'TestsPassed',
    Value: results.numPassedTests || 0,
    Unit: 'Count',
    Timestamp: timestamp
  });
  
  metricData.push({
    MetricName: 'TestsFailed',
    Value: results.numFailedTests || 0,
    Unit: 'Count',
    Timestamp: timestamp
  });
  
  // Test duration
  if (results.testResults) {
    const totalDuration = results.testResults.reduce((sum, suite) => 
      sum + (suite.perfStats?.runtime || 0), 0
    );
    
    metricData.push({
      MetricName: 'TestDuration',
      Value: totalDuration,
      Unit: 'Milliseconds',
      Timestamp: timestamp
    });
  }
  
  // Publish to CloudWatch
  await cloudwatch.putMetricData({
    Namespace: 'WebOrdinary/CI',
    MetricData: metricData
  }).promise();
  
  console.log(`Published ${metricData.length} metrics to CloudWatch`);
}

publishMetrics().catch(console.error);
```

### 5. Local CI Test Script
```bash
#!/bin/bash
# tests/integration/scripts/run-ci-local.sh

set -e

echo "🚀 Running CI tests locally..."

# Check dependencies
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required"
    exit 1
fi

if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is required"
    exit 1
fi

# Set environment
export TEST_ENVIRONMENT=${TEST_ENVIRONMENT:-test}
export AWS_PROFILE=${AWS_PROFILE:-personal}

# Install dependencies
echo "📦 Installing dependencies..."
npm ci

# Run tests
echo "🧪 Running integration tests..."

# Run each suite
SUITES=("s3-deployment" "git-workflow" "multi-session" "performance" "error-recovery")
FAILED_SUITES=()

for suite in "${SUITES[@]}"; do
    echo ""
    echo "Running $suite tests..."
    
    if npm test -- --testNamePattern="$suite" \
        --json --outputFile="results/${suite}-results.json"; then
        echo "✅ $suite tests passed"
    else
        echo "❌ $suite tests failed"
        FAILED_SUITES+=($suite)
    fi
done

# Generate summary
echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"

if [ ${#FAILED_SUITES[@]} -eq 0 ]; then
    echo "✅ All test suites passed!"
    exit 0
else
    echo "❌ Failed suites: ${FAILED_SUITES[*]}"
    exit 1
fi
```

### 6. Pre-commit Hook
```bash
# .husky/pre-push

#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Run integration tests before push
if [ "$SKIP_INTEGRATION_TESTS" != "true" ]; then
  echo "Running integration tests..."
  
  cd tests/integration
  npm test -- --testNamePattern="s3-deployment" --bail
  
  if [ $? -ne 0 ]; then
    echo "❌ Integration tests failed. Push aborted."
    echo "To skip tests, use: SKIP_INTEGRATION_TESTS=true git push"
    exit 1
  fi
fi
```

## Setup Instructions

### 1. Configure GitHub Secrets
```bash
# Required secrets:
# - AWS_ACCESS_KEY_ID
# - AWS_SECRET_ACCESS_KEY
# - INTERNAL_API_KEY
# - SLACK_WEBHOOK_URL
# - GITHUB_TOKEN (auto-provided)
```

### 2. Create S3 Bucket for Reports
```bash
aws s3 mb s3://webordinary-test-reports
aws s3api put-bucket-versioning \
  --bucket webordinary-test-reports \
  --versioning-configuration Status=Enabled
```

### 3. Set Up CloudWatch Dashboard
```bash
aws cloudwatch put-dashboard \
  --dashboard-name WebOrdinary-CI \
  --dashboard-body file://cloudwatch-dashboard.json
```

### 4. Enable GitHub Actions
- Go to repository Settings → Actions
- Enable Actions for the repository
- Configure runner permissions

## Testing

### Test CI Locally
```bash
cd tests/integration
./scripts/run-ci-local.sh
```

### Trigger Manual Run
```bash
gh workflow run integration-tests.yml \
  -f test_suite=performance \
  -f environment=test
```

### View Run Results
```bash
gh run list --workflow=integration-tests.yml
gh run view <run-id>
```

## Monitoring

### CloudWatch Metrics
- `WebOrdinary/CI/TestsPassed`
- `WebOrdinary/CI/TestsFailed`
- `WebOrdinary/CI/TestDuration`

### Slack Alerts
- Daily test failures
- PR test failures (optional)
- Performance degradation

## Acceptance Criteria
- [ ] GitHub Actions workflow created
- [ ] Tests run on every PR
- [ ] Daily scheduled runs working
- [ ] Test results reported to PR
- [ ] Performance metrics published
- [ ] Slack notifications configured
- [ ] Local CI script working
- [ ] Documentation complete

## Time Estimate
2-3 hours

## Notes
- Start with basic workflow, add features incrementally
- Consider test parallelization for speed
- Monitor GitHub Actions usage/costs
- Keep test data in S3 for trend analysis
- Consider adding badge to README