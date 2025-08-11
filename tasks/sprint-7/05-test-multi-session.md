# Task 05: Test Multi-Session Workflow

## Objective
Comprehensively test the complete multi-session workflow including rapid switching, interrupts, and concurrent operations.

## Context
We need to verify that the git workflow, S3 deployments, and session management work correctly under real-world conditions.

## Test Environment Setup

### 1. Prepare Test Container
```bash
# Build container with all Sprint 7 changes
cd /Users/scott/Projects/webordinary/claude-code-container
docker build --platform linux/amd64 -t claude-test:sprint7 .

# Run with full environment
docker run -it \
  --platform linux/amd64 \
  -v /tmp/workspace:/workspace \
  -v ~/.aws:/root/.aws:ro \
  -e AWS_PROFILE=personal \
  -e AWS_REGION=us-west-2 \
  -e GITHUB_TOKEN=${GITHUB_TOKEN} \
  -e CLIENT_ID=amelia \
  -e PROJECT_ID=stamps \
  -e WORKSPACE_PATH=/workspace/amelia/stamps \
  -e INPUT_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/.../test-queue \
  claude-test:sprint7
```

### 2. Create Test Messages
```javascript
// test-messages.js
const messages = {
  session1_msg1: {
    sessionId: "session-aaa-111",
    commandId: "cmd-001",
    chatThreadId: "thread-aaa",
    clientId: "amelia",
    instruction: "Add a welcome message to the homepage",
    userId: "test-user-1"
  },
  
  session2_msg1: {
    sessionId: "session-bbb-222",
    commandId: "cmd-002", 
    chatThreadId: "thread-bbb",
    clientId: "amelia",
    instruction: "Update the footer copyright year",
    userId: "test-user-1"
  },
  
  session1_msg2: {
    sessionId: "session-aaa-111",
    commandId: "cmd-003",
    chatThreadId: "thread-aaa",
    clientId: "amelia",
    instruction: "Change the welcome message color to blue",
    userId: "test-user-1"
  },
  
  interrupt_msg: {
    sessionId: "session-ccc-333",
    commandId: "cmd-004",
    chatThreadId: "thread-ccc",
    clientId: "amelia",
    instruction: "Emergency fix for contact form",
    userId: "test-user-2"
  }
};
```

## Test Scenarios

### Scenario 1: Basic Session Flow
**Test single session with multiple commands**

```bash
# Step 1: Send first message
node send-sqs.js session1_msg1

# Verify:
- [ ] Branch `thread-aaa` created
- [ ] Claude executes command
- [ ] Changes committed with proper message
- [ ] Astro builds successfully
- [ ] S3 sync completes
- [ ] Site updates at edit.amelia.webordinary.com
- [ ] Commits pushed to GitHub

# Step 2: Send second message to same session
node send-sqs.js session1_msg2

# Verify:
- [ ] Stays on branch `thread-aaa`
- [ ] New changes added to same branch
- [ ] Commit message reflects new instruction
- [ ] Site updates with cumulative changes
```

### Scenario 2: Session Switching
**Test switching between sessions**

```bash
# Step 1: Start session A
node send-sqs.js session1_msg1
# Wait for completion

# Step 2: Switch to session B
node send-sqs.js session2_msg1

# Verify:
- [ ] Commits session A changes
- [ ] Switches to branch `thread-bbb`
- [ ] Session B changes isolated from A
- [ ] Both branches exist in git
- [ ] S3 has latest from session B

# Step 3: Switch back to session A
node send-sqs.js session1_msg2

# Verify:
- [ ] Commits session B changes
- [ ] Switches back to `thread-aaa`
- [ ] Session A state restored
- [ ] Previous session A changes still present
- [ ] S3 updates to session A state
```

### Scenario 3: Interrupt During Build
**Test interruption during long operations**

```bash
# Step 1: Send message that triggers long build
node send-sqs.js session1_msg1

# Step 2: Immediately send interrupt (different session)
sleep 2  # Wait for build to start
node send-sqs.js interrupt_msg

# Verify:
- [ ] Build process interrupted
- [ ] Partial changes committed
- [ ] Switches to emergency session
- [ ] Emergency fix processes correctly
- [ ] S3 has emergency fix changes
```

### Scenario 4: Rapid Session Switching
**Test system under rapid switching load**

```bash
# Send messages in rapid succession
for i in {1..5}; do
  node send-sqs.js session1_msg1
  sleep 1
  node send-sqs.js session2_msg1
  sleep 1
done

# Verify:
- [ ] No git corruption
- [ ] All commits preserved
- [ ] Final state consistent
- [ ] S3 has latest changes
- [ ] No lost work
```

### Scenario 5: Concurrent Users
**Test different users working simultaneously**

```javascript
// Different user sessions
const user1_session = {
  sessionId: "user1-session",
  chatThreadId: "user1-thread",
  userId: "user-1",
  clientId: "amelia",
  instruction: "User 1 making changes"
};

const user2_session = {
  sessionId: "user2-session",
  chatThreadId: "user2-thread", 
  userId: "user-2",
  clientId: "amelia",
  instruction: "User 2 making changes"
};
```

```bash
# Send both user messages
node send-sqs.js user1_session &
node send-sqs.js user2_session &

# Verify:
- [ ] Both user branches created
- [ ] Changes don't conflict
- [ ] Both can push to GitHub
- [ ] S3 reflects last completed build
```

### Scenario 6: Recovery Testing
**Test recovery from various failure states**

```bash
# Test 1: Corrupt git state
docker exec -it [container] bash
cd /workspace
git merge --no-commit origin/conflicting-branch
# Send new message - should recover

# Test 2: Failed S3 sync
# Remove AWS credentials temporarily
unset AWS_PROFILE
# Send message - should handle gracefully

# Test 3: GitHub push failure
# Change remote to invalid URL
git remote set-url origin https://invalid.url
# Send message - should complete other steps
```

## Monitoring During Tests

### CloudWatch Logs
```bash
# Watch container logs
AWS_PROFILE=personal aws logs tail /ecs/webordinary/edit --follow

# Filter for errors
AWS_PROFILE=personal aws logs tail /ecs/webordinary/edit \
  --filter-pattern "ERROR"
```

### Git Repository
```bash
# Check branches
git branch -r

# Check commit history
git log --oneline --graph --all

# Verify pushes
git fetch --all
```

### S3 Bucket
```bash
# Check latest deployment
aws s3 ls s3://edit.amelia.webordinary.com/ --recursive \
  --summarize | tail -20

# Verify index.html updated
aws s3 cp s3://edit.amelia.webordinary.com/index.html - | \
  grep "Last modified"
```

### Website
```bash
# Check site is accessible
curl -I http://edit.amelia.webordinary.com

# Verify changes applied
curl http://edit.amelia.webordinary.com | grep "welcome message"
```

## Performance Metrics

Record timings for optimization:

| Operation | Target Time | Actual Time |
|-----------|------------|-------------|
| Session switch | < 5s | |
| Claude execution | < 30s | |
| Astro build | < 60s | |
| S3 sync | < 30s | |
| Git push | < 10s | |
| Total workflow | < 2 min | |

## Acceptance Criteria
- [ ] All test scenarios pass
- [ ] No data loss in any scenario
- [ ] Interrupts handled gracefully
- [ ] Git history remains clean
- [ ] S3 deployments successful
- [ ] Performance within targets
- [ ] Error recovery works
- [ ] Logs are clear and helpful

## Test Report Template
```markdown
## Sprint 7 Multi-Session Test Report

**Date**: [Date]
**Tester**: [Name]
**Environment**: [Local/ECS]

### Scenario Results
- [ ] Basic Session Flow: PASS/FAIL
- [ ] Session Switching: PASS/FAIL
- [ ] Interrupt Handling: PASS/FAIL
- [ ] Rapid Switching: PASS/FAIL
- [ ] Concurrent Users: PASS/FAIL
- [ ] Recovery Testing: PASS/FAIL

### Issues Found
1. [Issue description]
   - Steps to reproduce
   - Expected vs actual
   - Severity

### Performance
- Average workflow time: [X] seconds
- Slowest operation: [Operation]
- Memory usage: [X] MB
- CPU usage: [X]%

### Recommendations
- [Improvement suggestions]
```

## Time Estimate
2-3 hours for comprehensive testing

## Notes
- Run tests multiple times for consistency
- Test during different load conditions
- Document any edge cases discovered
- Consider automated test suite for future