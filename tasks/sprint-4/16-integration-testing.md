# Task 16: Integration Testing for Multi-Session SQS Architecture

## Objective
Implement comprehensive integration tests for the new multi-session, queue-based architecture to ensure all components work together correctly.

## Test Scenarios

### 1. Single User, Multiple Sessions
- User starts chat session A
- User starts chat session B for same project
- Verify both sessions use same container
- Test interrupt handling when switching sessions
- Verify git branches maintained separately

### 2. Container Lifecycle
- Start first session → container starts
- Add second session → reuses container
- Close first session → container stays alive
- Close second session → container shuts down after timeout
- Resume session → container restarts

### 3. Message Flow
- Send message to input queue
- Verify container processes message
- Check response in output queue
- Test message ordering within session
- Verify cross-session isolation

### 4. Interrupt Handling
- Start long-running operation in session A
- Send message to session B
- Verify session A interrupted gracefully
- Check partial work saved
- Verify session B processes correctly

## Test Implementation

```typescript
// hermes/test/integration/multi-session.spec.ts
describe('Multi-Session SQS Architecture', () => {
  let hermes: HermesTestClient;
  let sqs: SQSClient;
  let dynamodb: DynamoDBClient;
  let ecs: ECSClient;
  
  beforeEach(async () => {
    hermes = new HermesTestClient();
    sqs = new SQSClient({ region: 'us-west-2' });
    dynamodb = new DynamoDBClient({ region: 'us-west-2' });
    ecs = new ECSClient({ region: 'us-west-2' });
  });
  
  describe('Container Sharing', () => {
    it('should reuse container for same user+project', async () => {
      // Start first session
      const session1 = await hermes.createSession({
        clientId: 'test-client',
        projectId: 'test-project',
        userId: 'test@example.com',
        chatThreadId: 'thread-1',
        instruction: 'Add a hello world page'
      });
      
      // Get container info
      const container1 = await getContainerForSession(session1.sessionId);
      
      // Start second session for same user+project
      const session2 = await hermes.createSession({
        clientId: 'test-client',
        projectId: 'test-project',
        userId: 'test@example.com',
        chatThreadId: 'thread-2',
        instruction: 'Add a contact page'
      });
      
      // Get container info
      const container2 = await getContainerForSession(session2.sessionId);
      
      // Should be same container
      expect(container1.taskArn).toBe(container2.taskArn);
      expect(container1.containerId).toBe(container2.containerId);
    });
    
    it('should use different containers for different projects', async () => {
      // Start session for project A
      const sessionA = await hermes.createSession({
        clientId: 'test-client',
        projectId: 'project-a',
        userId: 'test@example.com',
        chatThreadId: 'thread-a'
      });
      
      // Start session for project B
      const sessionB = await hermes.createSession({
        clientId: 'test-client',
        projectId: 'project-b',
        userId: 'test@example.com',
        chatThreadId: 'thread-b'
      });
      
      const containerA = await getContainerForSession(sessionA.sessionId);
      const containerB = await getContainerForSession(sessionB.sessionId);
      
      // Should be different containers
      expect(containerA.taskArn).not.toBe(containerB.taskArn);
    });
  });
  
  describe('Interrupt Handling', () => {
    it('should interrupt current session when new message arrives', async () => {
      // Start long operation in session 1
      const session1 = await hermes.createSession({
        clientId: 'test-client',
        projectId: 'test-project',
        userId: 'test@example.com',
        chatThreadId: 'thread-1'
      });
      
      // Send long-running command
      const command1 = await hermes.sendCommand({
        sessionId: session1.sessionId,
        instruction: 'Refactor all components to use TypeScript'
      });
      
      // Wait briefly
      await sleep(2000);
      
      // Send command to different session on same container
      const session2 = await hermes.createSession({
        clientId: 'test-client',
        projectId: 'test-project',
        userId: 'test@example.com',
        chatThreadId: 'thread-2'
      });
      
      const command2 = await hermes.sendCommand({
        sessionId: session2.sessionId,
        instruction: 'Add a simple header'
      });
      
      // Check session 1 was interrupted
      const response1 = await waitForResponse(session1.outputQueueUrl, command1.commandId);
      expect(response1.interrupted).toBe(true);
      expect(response1.summary).toContain('interrupted');
      
      // Check session 2 completed
      const response2 = await waitForResponse(session2.outputQueueUrl, command2.commandId);
      expect(response2.success).toBe(true);
      
      // Verify partial work was saved
      const gitStatus = await getGitStatus(session1.sessionId);
      expect(gitStatus.hasUncommittedChanges).toBe(false); // Auto-committed
      expect(gitStatus.lastCommitMessage).toContain('Interrupted');
    });
  });
  
  describe('Queue Management', () => {
    it('should create and delete queues correctly', async () => {
      const sessionId = 'test-client-thread-123';
      
      // Create session
      const session = await hermes.createSession({
        clientId: 'test-client',
        projectId: 'test-project',
        userId: 'test@example.com',
        chatThreadId: 'thread-123'
      });
      
      // Verify queues exist
      const queues = await listQueuesForSession(sessionId);
      expect(queues).toHaveLength(3); // input, output, dlq
      expect(queues).toContain(expect.stringMatching(/webordinary-input-/));
      expect(queues).toContain(expect.stringMatching(/webordinary-output-/));
      expect(queues).toContain(expect.stringMatching(/webordinary-dlq-/));
      
      // Close session
      await hermes.closeSession(session.sessionId);
      
      // Wait for cleanup
      await sleep(5000);
      
      // Verify queues deleted
      const queuesAfter = await listQueuesForSession(sessionId);
      expect(queuesAfter).toHaveLength(0);
    });
    
    it('should handle queue discovery in container', async () => {
      // Mock container environment
      const container = new MockContainer({
        containerId: 'test-client-project-user'
      });
      
      // Start container queue discovery
      await container.startQueueDiscovery();
      
      // Create session and assign to container
      const session = await hermes.createSession({
        clientId: 'test-client',
        projectId: 'project',
        userId: 'user',
        chatThreadId: 'thread-1'
      });
      
      // Wait for discovery
      await sleep(2000);
      
      // Verify container discovered the queue
      const knownQueues = container.getKnownQueues();
      expect(knownQueues).toHaveLength(1);
      expect(knownQueues[0].sessionId).toBe(session.sessionId);
    });
  });
  
  describe('Message Processing', () => {
    it('should process messages in order within session', async () => {
      const session = await hermes.createSession({
        clientId: 'test-client',
        projectId: 'test-project',
        userId: 'test@example.com',
        chatThreadId: 'thread-1'
      });
      
      // Send multiple commands
      const commands = [];
      for (let i = 1; i <= 5; i++) {
        commands.push(
          await hermes.sendCommand({
            sessionId: session.sessionId,
            instruction: `Create file${i}.txt with content "${i}"`
          })
        );
      }
      
      // Wait for all responses
      const responses = await Promise.all(
        commands.map(cmd => 
          waitForResponse(session.outputQueueUrl, cmd.commandId)
        )
      );
      
      // Verify all succeeded
      responses.forEach(r => expect(r.success).toBe(true));
      
      // Verify files created in order
      const files = await listFiles(session.sessionId);
      expect(files).toEqual([
        'file1.txt',
        'file2.txt',
        'file3.txt',
        'file4.txt',
        'file5.txt'
      ]);
    });
  });
});

// Helper functions
async function getContainerForSession(sessionId: string) {
  const session = await dynamodb.getItem({
    TableName: 'webordinary-edit-sessions',
    Key: { sessionId: { S: sessionId } }
  });
  
  const container = await dynamodb.getItem({
    TableName: 'webordinary-containers',
    Key: { containerId: { S: session.Item.containerId.S } }
  });
  
  return {
    containerId: container.Item.containerId.S,
    taskArn: container.Item.taskArn.S
  };
}

async function waitForResponse(queueUrl: string, commandId: string, timeout = 30000) {
  const endTime = Date.now() + timeout;
  
  while (Date.now() < endTime) {
    const result = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 5
    }));
    
    for (const message of result.Messages || []) {
      const body = JSON.parse(message.Body);
      if (body.commandId === commandId) {
        await sqs.send(new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.ReceiptHandle
        }));
        return body;
      }
    }
  }
  
  throw new Error(`Response timeout for command ${commandId}`);
}
```

## Load Testing

```typescript
// hermes/test/load/concurrent-sessions.spec.ts
describe('Load Testing', () => {
  it('should handle 10 concurrent sessions', async () => {
    const sessions = [];
    
    // Create 10 sessions across 3 projects
    for (let i = 0; i < 10; i++) {
      const projectId = `project-${i % 3}`;
      sessions.push(
        await hermes.createSession({
          clientId: 'load-test',
          projectId,
          userId: `user${Math.floor(i / 3)}@example.com`,
          chatThreadId: `thread-${i}`,
          instruction: `Task ${i}`
        })
      );
    }
    
    // Send commands to all sessions
    const commands = await Promise.all(
      sessions.map(s => 
        hermes.sendCommand({
          sessionId: s.sessionId,
          instruction: 'Add a test file'
        })
      )
    );
    
    // Wait for all responses
    const responses = await Promise.all(
      commands.map((cmd, i) => 
        waitForResponse(sessions[i].outputQueueUrl, cmd.commandId)
      )
    );
    
    // Verify all succeeded
    responses.forEach(r => expect(r.success).toBe(true));
    
    // Verify container count (should be ~3-4 containers)
    const containers = await listActiveContainers();
    expect(containers.length).toBeLessThanOrEqual(4);
  });
});
```

## Success Criteria
- [ ] All integration tests pass
- [ ] Container sharing works correctly
- [ ] Interrupt handling functions properly
- [ ] Queue lifecycle managed correctly
- [ ] Message ordering preserved
- [ ] Load tests demonstrate scalability

## Testing Environment
- Use test AWS account or localstack
- Mock services where appropriate
- Clean up resources after tests
- Monitor CloudWatch during tests
- Document test coverage metrics