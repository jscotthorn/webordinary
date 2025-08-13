# WebOrdinary Refactor Action Plan

## Executive Summary

The WebOrdinary codebase contains remnants from 3 architectural iterations:
1. **v1**: Direct HTTP serving from containers (Sprint 1-3)
2. **v2**: ALB routing with WebSocket HMR (Sprint 4-5)
3. **v3**: S3 static hosting with SQS messaging (Sprint 6-7) ← **CURRENT**

This creates confusion for developers and AI assistants. We need systematic cleanup.

## Critical Issues (Day 0 - Immediate)

### REPO_URL Blocking Issue (1-2 hours)
1. **Remove REPO_URL from main.ts** - Line 25-34 in claude-code-container
2. **Update message processing** - Get repo from message.repoUrl
3. **Fix CDK task definition** - Remove hardcoded REPO_URL
4. **Test container startup** - Ensure works without env var

### Thread ID Continuity Issue (1-2 hours)
1. **Add body extraction** - Extract thread ID from email body
2. **Update email template** - Include thread ID in footer
3. **Test with Gmail/Outlook** - Verify thread preservation
4. **Deploy Hermes update** - Fix session fragmentation

Both issues are blocking proper functionality!

## Quick Wins (Day 1)

### Morning (2-3 hours)
1. **Clean Production DLQ** - Remove invalid test messages
2. **Fix environment variables** - Remove CLIENT_ID, DEFAULT_* vars
3. Run audit searches to find all legacy code
4. Prioritize by impact and risk

### Afternoon (2-3 hours)
1. **Fix Hermes message parsing** - Add format validation
2. Remove obvious dead code (unused files)
3. Update all .env.example files
4. Update root CLAUDE.md with terminology clarifications

## Phase 1: Code Cleanup (Days 2-3)

### Container Cleanup
**Owner**: Backend Team  
**Duration**: 1 day

1. Remove Express server from claude-code-container
2. Delete port 8080 configurations
3. Update terminology (project+user, not session ownership)
4. Update tests to remove HTTP endpoint checks
5. Verify SQS → S3 flow works

### Hermes Cleanup
**Owner**: Backend Team  
**Duration**: 0.5 days

1. Fix message format handling (SES vs raw)
2. Clarify project+user claiming in code
3. Remove unnecessary HTTP endpoints
4. Keep only health check endpoint
5. Update logging for clarity
6. Add development queue support

### Infrastructure Cleanup
**Owner**: DevOps Team  
**Duration**: 1 day

1. Remove ALB web routing rules via CDK
2. Simplify target groups
3. Update security groups
4. Deploy changes incrementally

## Phase 2: Test Modernization (Days 4-5)

### Integration Tests
**Owner**: QA Team  
**Duration**: 1 day

1. Remove ALB routing tests
2. Add S3 deployment verification
3. Test queue-based message flow
4. Verify claim/unclaim patterns

### Unit Tests
**Owner**: Backend Team  
**Duration**: 0.5 days

1. Update mocked services
2. Remove HTTP-related tests
3. Add queue processing tests

### E2E Tests
**Owner**: QA Team  
**Duration**: 0.5 days

1. Test email → S3 flow
2. Multi-user scenarios
3. Interrupt handling
4. Git operations

## Phase 3: Documentation (Day 6)

### Component READMEs
**Owner**: Tech Lead  
**Duration**: 0.5 days

1. Update all component READMEs
2. Remove legacy examples
3. Add current architecture diagrams

### Quick References
**Owner**: Tech Lead  
**Duration**: 0.5 days

1. Update all CLAUDE.md files
2. Remove outdated commands
3. Add troubleshooting for new architecture

## Validation Checklist

### Before Starting
- [ ] All developers aware of refactor
- [ ] Backup of current working state
- [ ] Test environment available

### After Each Phase
- [ ] All tests passing
- [ ] Services deploying successfully
- [ ] No regression in functionality
- [ ] Documentation reflects changes

### Final Validation
- [ ] New developer can understand system
- [ ] AI assistants get correct context
- [ ] No legacy code remains
- [ ] All documentation current

## Risk Mitigation

### High Risk Areas
1. **ALB Changes**: Could break health checks
   - Mitigation: Test in dev first, rollback ready

2. **Queue Changes**: Could lose messages
   - Mitigation: Keep DLQ, monitor closely

3. **Test Breaks**: Could miss regressions
   - Mitigation: Fix tests before code changes

### Rollback Strategy
1. Git tags before each phase
2. CDK stack snapshots
3. Database backups
4. S3 bucket versioning enabled

## Success Metrics

1. **Code Reduction**: Remove 20-30% of codebase
2. **Test Coverage**: Maintain or improve
3. **Documentation**: 100% accurate
4. **Deploy Time**: Faster without web server
5. **Developer Clarity**: No confusion about architecture

## Communication Plan

### Daily Standups
- Report progress on checklist items
- Raise blockers immediately
- Share findings from audits

### Documentation Updates
- Update this ACTION_PLAN.md daily
- Move completed items to completed/ folder
- Create issues/ entries for problems

### Stakeholder Updates
- End of Day 1: Audit complete
- End of Day 3: Code cleanup complete
- End of Day 5: Tests updated
- End of Day 6: Documentation complete

## Timeline Summary

```
Day 1: Audit and Quick Wins
Day 2: Container and Hermes Cleanup
Day 3: Infrastructure Cleanup
Day 4: Integration and E2E Tests
Day 5: Unit Tests and Validation
Day 6: Documentation and Final Review
```

## Next Immediate Steps

1. **Right Now**: Review this plan and adjust
2. **Next Hour**: Run audit searches
3. **Today**: Complete quick wins
4. **Tomorrow**: Start Phase 1 cleanup

## Command Reference

```bash
# Find legacy patterns
./refactor-authority/scripts/audit.sh

# Test after changes
npm test
AWS_PROFILE=personal npm run test:integration

# Deploy changes
npx cdk deploy --all --profile personal

# Monitor services
AWS_PROFILE=personal aws logs tail /ecs/hermes --since 5m
AWS_PROFILE=personal aws logs tail /ecs/webordinary/edit --since 5m
```

---

**Status**: Ready to Execute  
**Blocker**: None  
**Owner**: System Architecture Team  
**Start Date**: 2025-01-13 (Proposed)