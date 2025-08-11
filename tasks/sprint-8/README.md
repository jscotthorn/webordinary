# Sprint 8: Full Integration Testing

## Sprint Goal
Complete the integration test suite to validate the entire email → Claude → Git → Build → S3 workflow, including the new S3 static hosting architecture.

## Sprint Overview
**Duration**: 1-2 weeks  
**Focus**: Integration testing of new architecture and existing scenarios  
**Outcome**: Comprehensive test coverage with CI/CD readiness

## Context
We have a robust integration testing framework with:
- Test harness for AWS service orchestration
- Several test scenarios partially implemented
- Infrastructure validation already working
- Session resumption tests in progress

Now we need to:
- Update tests for S3 static hosting (no more ALB routing to containers)
- Complete existing test scenarios
- Add new tests for git workflows and S3 deployments
- Ensure all Sprint 6-7 changes are tested

## Current Test Status
- ✅ Infrastructure validation
- 🔧 Cold start session flow (needs S3 updates)
- 🔧 Session persistence (needs git branch testing)
- 🔧 Concurrent sessions (needs S3 deployment verification)
- ❌ ALB routing (obsolete - needs replacement with S3 tests)
- 🔧 Session resumption (needs updates for new flow)

## Task Breakdown

### Core Test Updates

1. **[Task 01: Update Tests for S3 Architecture](01-update-tests-s3-architecture.md)** (3-4 hours)
   - Remove ALB routing tests to containers
   - Add S3 deployment verification
   - Update endpoint checks for S3 static sites
   - Modify health checks for new architecture

2. **[Task 02: Test Email to S3 Workflow](02-test-email-to-s3-workflow.md)** (3-4 hours)
   - End-to-end test: Email → Hermes → Container → S3
   - Verify S3 site updates after email processing
   - Test build failures and error handling
   - Measure complete workflow timing

3. **[Task 03: Git Workflow Testing](03-test-git-workflow.md)** (2-3 hours)
   - Test branch creation per session
   - Verify commits and push operations
   - Test session switching and branch isolation
   - Validate interrupt handling and auto-commits

4. **[Task 04: Multi-Session S3 Testing](04-test-multi-session-s3.md)** (2-3 hours)
   - Test rapid session switching with S3 deployments
   - Verify S3 reflects correct session state
   - Test concurrent builds and deployments
   - Validate no cross-session contamination

5. **[Task 05: Performance and Load Testing](05-performance-load-testing.md)** (3-4 hours)
   - Benchmark workflow performance
   - Test system under load (multiple concurrent sessions)
   - Identify bottlenecks in build/deploy pipeline
   - Generate performance report

6. **[Task 06: Error Recovery Testing](06-error-recovery-testing.md)** (2-3 hours)
   - Test S3 sync failures
   - Git push failures and recovery
   - Build failures and partial deployments
   - Container crash recovery

7. **[Task 07: CI/CD Integration](07-cicd-integration.md)** (2-3 hours)
   - Set up GitHub Actions workflow
   - Configure test execution in CI
   - Add test result reporting
   - Implement test failure notifications

## Success Criteria
- [ ] All test scenarios pass consistently
- [ ] S3 deployments verified in tests
- [ ] Git workflows fully tested
- [ ] Performance benchmarks established
- [ ] Error scenarios handled gracefully
- [ ] CI/CD pipeline configured
- [ ] Test coverage > 80% for critical paths

## Test Execution Plan

### Local Testing
```bash
cd tests/integration
npm install
npm run test:integration
```

### Specific Scenario Testing
```bash
# S3 deployment tests
npm test -- --testNamePattern="S3 Deployment"

# Git workflow tests
npm test -- --testNamePattern="Git Workflow"

# Performance tests
npm run test:performance
```

### CI/CD Testing
- Runs on every PR
- Daily scheduled runs
- Performance reports to CloudWatch

## Risk Mitigation
| Risk | Impact | Mitigation |
|------|--------|------------|
| S3 eventual consistency | Test failures | Add retry logic, wait for consistency |
| Git conflicts in tests | False failures | Clean git state between tests |
| Test data pollution | Inconsistent results | Unique test prefixes, cleanup |
| AWS costs | Budget overrun | Limit concurrent tests, auto-cleanup |

## Performance Targets
| Metric | Target | Current |
|--------|--------|---------|
| Email to S3 deployment | < 2 min | TBD |
| Session creation | < 30 sec | TBD |
| Git commit & push | < 10 sec | TBD |
| S3 sync (small site) | < 15 sec | TBD |
| S3 sync (large site) | < 45 sec | TBD |

## Dependencies
- Sprint 6 & 7 completed (S3 setup and git workflows)
- AWS test environment configured
- S3 buckets created for testing
- Git repository accessible

## Notes
- Update existing tests rather than rewriting
- Focus on new S3 architecture
- Keep tests independent and idempotent
- Document any flaky tests for investigation