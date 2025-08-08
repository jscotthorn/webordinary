# Task 07: Core Integration Test Scenarios

## Overview
Implement the four core integration test scenarios that verify the complete system functionality: cold start session flow, session persistence, concurrent session handling, and ALB routing verification.

## Scope
Build comprehensive test suites that validate the end-to-end workflow from email processing through live preview delivery, ensuring all AWS services work together correctly.

## Implementation Plan

### Day 3: Cold Start & Session Flow
- **Scenario 1: Cold Start Session Flow**
  - Verify complete cold start from 0 containers
  - Test session creation and DynamoDB storage
  - Validate container scaling (0→1) within 60 seconds
  - Confirm preview URL accessibility and HMR
  - Verify auto-shutdown after idle timeout

### Day 4: Persistence & Concurrency
- **Scenario 2: Session Persistence & Resume**
  - Test EFS persistence across container restarts
  - Verify workspace state maintenance
  - Validate git history preservation
  - Test session resume from existing workspace

- **Scenario 3: Concurrent Session Handling**
  - Create multiple simultaneous sessions
  - Verify independent workspace isolation
  - Test auto-scaling to maximum capacity (3 tasks)
  - Confirm individual session lifecycle management

### Day 5: Routing & Integration
- **Scenario 4: ALB Routing Integration**
  - Verify path-based routing to correct services
  - Test API endpoint accessibility (`/api/*`)
  - Validate Hermes routing (`/hermes/*`)
  - Confirm session-specific routing (`/session/{id}`)
  - Test WebSocket upgrade for HMR

## Core Test Scenarios

### Cold Start Flow Test
```typescript
test('should create session and scale containers from zero', async () => {
  // 1. Verify services start at 0 tasks
  await verifyServiceTaskCount('hermes', 0);
  await verifyServiceTaskCount('edit', 0);
  
  // 2. Trigger session creation via API
  const session = await createTestSession({
    clientId: 'test-client',
    userId: 'test@example.com',
    instruction: 'Add a new page called "Test Page"'
  });
  
  // 3. Verify session in DynamoDB
  await verifySessionExists(session.sessionId);
  
  // 4. Wait for container scaling (max 60s)
  await waitForContainerReady(session.sessionId, 60000);
  
  // 5. Verify preview URL accessible
  const response = await fetch(session.previewUrl);
  expect(response.status).toBe(200);
});
```

### Persistence Test
```typescript
test('should maintain workspace state across container restarts', async () => {
  // Create session and make changes
  const session1 = await createTestSession({
    instruction: 'Create a components/Header.astro file'
  });
  
  await waitForContainerReady(session1.sessionId);
  await verifyFileExists(`/workspace/test-client/test/project/src/components/Header.astro`);
  
  // Force container shutdown
  await forceScaleDown('edit', 0);
  
  // Create new session (should resume from existing workspace)
  const session2 = await createTestSession({
    clientId: 'test-client',
    instruction: 'Update Header.astro with new content'
  });
  
  // Verify previous files still exist
  await waitForContainerReady(session2.sessionId);
  await verifyFileExists(`/workspace/test-client/test/project/src/components/Header.astro`);
});
```

## Success Criteria
- ✅ Cold start session creation: < 60 seconds end-to-end
- ✅ Session persistence across container restarts: 100% file retention
- ✅ Concurrent sessions: 3+ simultaneous with workspace isolation
- ✅ ALB routing: All endpoints accessible with correct responses
- ✅ Auto-scaling: Proper scale-up and scale-down behavior

## Timeline: 3 days
## Dependencies: Task 06 (Integration Test Infrastructure)
## Cost: ~$10-20 for extended testing scenarios