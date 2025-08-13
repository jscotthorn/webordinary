# WebOrdinary Legacy Code Audit Results
Generated: 2025-01-13

## 1. Environment Variables (COMPLETED)

### CLIENT_ID/DEFAULT_* Variables
**Status**: ✅ REFACTORED
- Removed from source code in claude-code-container
- Updated services to use QueueManagerService.getCurrentClaim()
- Test files still have references (may need updating)

**Files Updated**:
- `/claude-code-container/src/services/queue-manager.service.ts` - No longer sets env vars
- `/claude-code-container/src/services/git.service.ts` - Uses queue manager claim
- `/claude-code-container/src/services/s3-sync.service.ts` - Uses queue manager claim  
- `/claude-code-container/src/message-processor.service.ts` - Uses queue manager claim

## 2. HTTP/WebSocket Architecture

### Port 8080 References
**Status**: ⚠️ NEEDS CLEANUP
- Found in Hermes configuration files
- Found in Fargate manager service

**Files to Update**:
- `/hermes/src/core/config/global.configuration.ts`
- `/hermes/src/modules/edit-session/services/edit-session.service.ts`
- `/hermes/src/modules/edit-session/services/fargate-manager.service.ts`

### Express Server References
**Status**: ⚠️ LEGACY CODE EXISTS
- Package references in package-lock.json (normal)
- References in various service files (need review)

### WebSocket References
**Status**: ✅ MOSTLY IN DOCS
- Only found in task documentation (historical)
- No active WebSocket code in source

### Localhost References
**Status**: ⚠️ NEEDS REVIEW
- `/hermes/src/core/config/global.configuration.ts`
- `/hermes/src/main.ts`

## 3. ALB Web Routing

### ALB References
**Status**: ⚠️ INFRASTRUCTURE CODE EXISTS
- Active ALB stack in Hephaestus
- Integration tests still checking ALB
- Need to remove web routing rules

**Files to Update**:
- `/hephaestus/lib/alb-stack.ts` - Remove web routing
- `/tests/integration/scenarios/*.test.ts` - Update tests

## 4. Session vs Project+User Pattern

### Session-per-Container References
**Status**: ⚠️ CRITICAL - TESTS AND INFRA
- Integration tests assume session-per-container
- Session stack in Hephaestus
- Container lifecycle stack references

**Files to Update**:
- `/tests/integration/scenarios/*.test.ts` - All test scenarios
- `/hephaestus/lib/session-stack.ts` - May need removal
- `/hephaestus/lib/container-lifecycle-stack.ts` - Update logic

## 5. Documentation Issues

### Port 8080 in Docs
**Status**: ⚠️ WIDESPREAD IN TASKS
- Historical task documentation (OK to keep)
- May confuse developers reading old tasks

### README Files
**Status**: 🔍 NEEDS REVIEW
- Check all component READMEs for accuracy

## Summary Statistics

- **Total Files Needing Updates**: ~25
- **Critical Issues**: 3 (Environment vars, Session pattern, ALB routing)
- **Documentation Issues**: Multiple task files
- **Test Files Affected**: 10+

## Priority Ranking

### HIGH PRIORITY (Blocking functionality)
1. ✅ Environment variables (COMPLETED)
2. Session-per-container pattern in tests
3. ALB routing rules

### MEDIUM PRIORITY (Confusion risk)
4. Port 8080 references in Hermes
5. Express server remnants
6. Documentation updates

### LOW PRIORITY (Cleanup)
7. Historical task documentation
8. Code comments
9. Unused imports