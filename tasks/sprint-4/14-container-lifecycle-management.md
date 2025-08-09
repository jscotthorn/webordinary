# Task 14: Container Lifecycle Management for User+Project

## Objective
Implement Fargate container management that creates one container per user+project combination, with proper lifecycle handling for multiple chat sessions.

## Requirements

### Container Identity
1. **Container ID Format**:
   - Pattern: `{clientId}-{projectId}-{userId}`
   - Example: `ameliastamps-website-john@email.com`
   - Used for container tagging and discovery

2. **Container-to-Session Mapping**:
   - One container serves multiple chat sessions
   - DynamoDB tracks which sessions map to which container
   - Container remains alive while any session is active

3. **Lifecycle Rules**:
   - Start container on first session for user+project
   - Keep alive while sessions active
   - Idle timeout when all sessions inactive for 20 minutes
   - Graceful shutdown with state preservation

## Implementation Steps

1. Update CDK to tag containers with user+project
2. Modify Hermes to check for existing containers
3. Implement container discovery in DynamoDB
4. Add session counting for lifecycle decisions
5. Update auto-shutdown logic

## CDK Updates

```typescript
// hephaestus/lib/fargate-stack.ts
export class FargateStack extends cdk.Stack {
  createTaskDefinition(clientId: string, projectId: string, userId: string) {
    const taskDef = new ecs.FargateTaskDefinition(this, 'EditTaskDef', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      family: `webordinary-edit-${clientId}-${projectId}`
    });
    
    const container = taskDef.addContainer('edit-container', {
      image: ecs.ContainerImage.fromEcr(this.ecrRepo, 'latest'),
      environment: {
        CLIENT_ID: clientId,
        PROJECT_ID: projectId,
        USER_ID: userId,
        CONTAINER_ID: `${clientId}-${projectId}-${userId}`,
        WORKSPACE_PATH: `/workspace/${clientId}/${projectId}`,
        AUTO_SHUTDOWN_MINUTES: '20'
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `${clientId}-${projectId}`,
        logGroup: this.logGroup
      })
    });
    
    // Tag the task for discovery
    cdk.Tags.of(taskDef).add('ContainerId', `${clientId}-${projectId}-${userId}`);
    cdk.Tags.of(taskDef).add('ClientId', clientId);
    cdk.Tags.of(taskDef).add('ProjectId', projectId);
    
    return taskDef;
  }
}
```

## Hermes Container Manager

```typescript
// hermes/src/modules/edit-session/services/container-manager.service.ts
@Injectable()
export class ContainerManagerService {
  async getOrCreateContainer(
    clientId: string,
    projectId: string,
    userId: string
  ): Promise<ContainerInfo> {
    const containerId = `${clientId}-${projectId}-${userId}`;
    
    // Check for existing container
    const existing = await this.findRunningContainer(containerId);
    if (existing) {
      console.log(`Found existing container: ${containerId}`);
      return existing;
    }
    
    // Start new container
    console.log(`Starting new container: ${containerId}`);
    const taskArn = await this.startContainer(clientId, projectId, userId);
    
    // Wait for container to be ready
    const containerInfo = await this.waitForContainer(taskArn);
    
    // Store container mapping
    await this.dynamoDB.putItem({
      TableName: 'webordinary-containers',
      Item: {
        containerId,
        taskArn,
        containerIp: containerInfo.privateIp,
        clientId,
        projectId,
        userId,
        createdAt: new Date().toISOString(),
        lastActivity: Date.now(),
        sessionCount: 0
      }
    });
    
    return containerInfo;
  }
  
  async assignSessionToContainer(
    sessionId: string,
    containerId: string,
    queueUrls: QueueUrls
  ): Promise<void> {
    // Record session-to-container mapping
    await this.dynamoDB.putItem({
      TableName: 'webordinary-edit-sessions',
      Item: {
        sessionId,
        containerId,
        inputQueueUrl: queueUrls.inputUrl,
        outputQueueUrl: queueUrls.outputUrl,
        createdAt: new Date().toISOString(),
        lastActivity: Date.now()
      }
    });
    
    // Increment session count on container
    await this.dynamoDB.updateItem({
      TableName: 'webordinary-containers',
      Key: { containerId },
      UpdateExpression: 'ADD sessionCount :inc SET lastActivity = :now',
      ExpressionAttributeValues: {
        ':inc': 1,
        ':now': Date.now()
      }
    });
  }
  
  async releaseSession(sessionId: string): Promise<void> {
    // Get container for this session
    const session = await this.dynamoDB.getItem({
      TableName: 'webordinary-edit-sessions',
      Key: { sessionId }
    });
    
    if (session?.Item?.containerId) {
      // Decrement session count
      const result = await this.dynamoDB.updateItem({
        TableName: 'webordinary-containers',
        Key: { containerId: session.Item.containerId },
        UpdateExpression: 'ADD sessionCount :dec',
        ExpressionAttributeValues: { ':dec': -1 },
        ReturnValues: 'ALL_NEW'
      });
      
      // Check if container should shut down
      if (result.Attributes?.sessionCount === 0) {
        console.log(`Container ${session.Item.containerId} has no active sessions`);
        // Container will auto-shutdown after idle timeout
      }
    }
    
    // Delete session record
    await this.dynamoDB.deleteItem({
      TableName: 'webordinary-edit-sessions',
      Key: { sessionId }
    });
  }
}
```

## Container Auto-Shutdown Updates

```bash
#!/bin/bash
# claude-code-container/scripts/auto-shutdown.sh

IDLE_MINUTES=${AUTO_SHUTDOWN_MINUTES:-20}
CONTAINER_ID=${CONTAINER_ID}

check_activity() {
  # Query DynamoDB for active sessions
  aws dynamodb query \
    --table-name webordinary-edit-sessions \
    --index-name container-index \
    --key-condition-expression "containerId = :cid" \
    --expression-attribute-values "{\":cid\":{\"S\":\"$CONTAINER_ID\"}}" \
    --select COUNT \
    --output json | jq -r '.Count'
}

while true; do
  SESSION_COUNT=$(check_activity)
  
  if [ "$SESSION_COUNT" -eq 0 ]; then
    echo "No active sessions, starting idle timer..."
    sleep $((IDLE_MINUTES * 60))
    
    # Re-check after idle period
    SESSION_COUNT=$(check_activity)
    if [ "$SESSION_COUNT" -eq 0 ]; then
      echo "Shutting down after $IDLE_MINUTES minutes idle"
      
      # Push any uncommitted changes
      cd $WORKSPACE_PATH
      git add -A
      git commit -m "Auto-save: Container shutdown" || true
      git push origin --all || true
      
      # Update container status
      aws dynamodb update-item \
        --table-name webordinary-containers \
        --key "{\"containerId\":{\"S\":\"$CONTAINER_ID\"}}" \
        --update-expression "SET containerStatus = :status" \
        --expression-attribute-values "{\":status\":{\"S\":\"terminated\"}}"
      
      exit 0
    fi
  fi
  
  sleep 60
done
```

## Success Criteria
- [ ] Containers identified by user+project combination
- [ ] Multiple sessions can share same container
- [ ] Container discovery works correctly
- [ ] Session counting accurate
- [ ] Auto-shutdown respects active sessions
- [ ] State preserved on shutdown

## Testing
- Test container reuse for same user+project
- Verify multiple sessions on one container
- Test auto-shutdown with active sessions
- Test session release and container lifecycle
- Verify container discovery in DynamoDB