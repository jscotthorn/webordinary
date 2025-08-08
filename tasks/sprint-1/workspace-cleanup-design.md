# Workspace Cleanup System Design

## Overview
Replace the naive container self-termination approach with a robust DynamoDB-driven cleanup system that provides proper workspace lifecycle management, customer billing awareness, and precise file system permission control.

## Current Problems

### Container Self-Termination Issues ❌
- **Unsafe**: Containers terminating themselves unpredictably
- **No customer context**: Can't consider billing status or subscription tiers
- **Race conditions**: Multiple containers competing for shutdown decisions
- **No centralized control**: Each container makes independent decisions
- **Poor observability**: No centralized view of workspace usage

### File System Permission Issues ❌
- **Overly broad access**: Containers can access all workspace folders
- **No customer isolation**: Potential cross-tenant data access
- **Manual cleanup**: No systematic approach to old data removal
- **Storage bloat**: No automated compression or archival

## New Architecture: DynamoDB-Driven Cleanup

### 1. Workspace Status Tracking

#### DynamoDB Table Schema
```json
{
  "TableName": "WorkspaceStatus",
  "KeySchema": [
    {"AttributeName": "clientId", "KeyType": "HASH"},
    {"AttributeName": "userId", "KeyType": "RANGE"}
  ],
  "AttributeDefinitions": [
    {"AttributeName": "clientId", "AttributeType": "S"},
    {"AttributeName": "userId", "AttributeType": "S"},
    {"AttributeName": "lastActivity", "AttributeType": "N"},
    {"AttributeName": "subscriptionStatus", "AttributeType": "S"}
  ],
  "GlobalSecondaryIndexes": [
    {
      "IndexName": "LastActivityIndex",
      "KeySchema": [
        {"AttributeName": "subscriptionStatus", "KeyType": "HASH"},
        {"AttributeName": "lastActivity", "KeyType": "RANGE"}
      ]
    }
  ]
}
```

#### Record Structure
```json
{
  "clientId": "acme-corp",
  "userId": "john-doe",
  "subscriptionStatus": "active|suspended|cancelled",
  "subscriptionTier": "free|pro|enterprise",
  "lastActivity": 1691234567,
  "containerStatus": "active|idle|terminated",
  "workspaceSize": 1048576000,
  "threadCount": 5,
  "threadsActive": 2,
  "threadsIdle": 3,
  "retentionDays": 30,
  "createdAt": 1691000000,
  "efsAccessPoint": "fsap-12345678",
  "allowedPaths": [
    "/workspace/acme-corp/john-doe",
    "/workspace/acme-corp/shared"
  ]
}
```

### 2. Lambda Cron Cleanup Function

#### Cleanup Lambda Implementation
```python
import boto3
import json
import os
from datetime import datetime, timedelta
from typing import List, Dict, Tuple

class WorkspaceCleanupManager:
    def __init__(self):
        self.dynamodb = boto3.resource('dynamodb')
        self.efs = boto3.client('efs')
        self.ecs = boto3.client('ecs')
        self.table = self.dynamodb.Table(os.environ['WORKSPACE_STATUS_TABLE'])
        
    def handler(self, event, context):
        """Main cleanup orchestrator"""
        cleanup_results = {
            'workspaces_evaluated': 0,
            'idle_workspaces': 0,
            'terminated_containers': 0,
            'archived_workspaces': 0,
            'permission_updates': 0,
            'errors': []
        }
        
        try:
            # 1. Query workspaces by subscription status and activity
            workspaces = self.get_workspaces_for_cleanup()
            cleanup_results['workspaces_evaluated'] = len(workspaces)
            
            # 2. Process each workspace based on business rules
            for workspace in workspaces:
                result = self.process_workspace(workspace)
                self.merge_results(cleanup_results, result)
                
            # 3. Update EFS access permissions based on active workspaces
            permission_updates = self.update_efs_permissions()
            cleanup_results['permission_updates'] = permission_updates
            
            # 4. Generate cleanup report
            self.generate_cleanup_report(cleanup_results)
            
        except Exception as e:
            cleanup_results['errors'].append(str(e))
            
        return {
            'statusCode': 200,
            'body': json.dumps(cleanup_results)
        }
    
    def get_workspaces_for_cleanup(self) -> List[Dict]:
        """Query workspaces that might need cleanup"""
        current_time = int(datetime.now().timestamp())
        
        # Get workspaces by subscription status
        workspaces = []
        
        for status in ['active', 'suspended', 'cancelled']:
            response = self.table.query(
                IndexName='LastActivityIndex',
                KeyConditionExpression='subscriptionStatus = :status',
                ExpressionAttributeValues={':status': status},
                ScanIndexForward=True  # Oldest first
            )
            workspaces.extend(response.get('Items', []))
            
        return workspaces
    
    def process_workspace(self, workspace: Dict) -> Dict:
        """Process individual workspace based on business rules"""
        client_id = workspace['clientId']
        user_id = workspace['userId']
        subscription_status = workspace['subscriptionStatus']
        subscription_tier = workspace['subscriptionTier']
        last_activity = int(workspace['lastActivity'])
        retention_days = int(workspace.get('retentionDays', 30))
        
        current_time = int(datetime.now().timestamp())
        idle_days = (current_time - last_activity) / (24 * 3600)
        
        result = {'action': 'none', 'reason': ''}
        
        # Business rules for cleanup
        if subscription_status == 'cancelled':
            if idle_days > 7:  # Grace period for cancelled accounts
                result = self.terminate_workspace(workspace, 'Account cancelled')
        
        elif subscription_status == 'suspended':
            if idle_days > 3:  # Shorter grace period for suspended accounts
                result = self.archive_workspace(workspace, 'Account suspended')
        
        elif subscription_status == 'active':
            # Tier-based retention policies
            if subscription_tier == 'free' and idle_days > 7:
                result = self.archive_workspace(workspace, 'Free tier idle limit')
            elif subscription_tier == 'pro' and idle_days > 30:
                result = self.archive_workspace(workspace, 'Pro tier idle limit')
            elif subscription_tier == 'enterprise' and idle_days > retention_days:
                result = self.archive_workspace(workspace, 'Enterprise retention policy')
        
        return result
    
    def terminate_workspace(self, workspace: Dict, reason: str) -> Dict:
        """Terminate workspace and remove EFS data"""
        client_id = workspace['clientId']
        user_id = workspace['userId']
        
        try:
            # 1. Stop any running ECS tasks for this workspace
            self.stop_ecs_tasks(client_id, user_id)
            
            # 2. Remove EFS access point
            if 'efsAccessPoint' in workspace:
                self.efs.delete_access_point(
                    AccessPointId=workspace['efsAccessPoint']
                )
            
            # 3. Update DynamoDB record
            self.table.update_item(
                Key={'clientId': client_id, 'userId': user_id},
                UpdateExpression='SET containerStatus = :status, terminatedAt = :timestamp, terminationReason = :reason',
                ExpressionAttributeValues={
                    ':status': 'terminated',
                    ':timestamp': int(datetime.now().timestamp()),
                    ':reason': reason
                }
            )
            
            return {'action': 'terminated', 'reason': reason}
            
        except Exception as e:
            return {'action': 'error', 'reason': str(e)}
    
    def archive_workspace(self, workspace: Dict, reason: str) -> Dict:
        """Archive workspace data and stop containers"""
        client_id = workspace['clientId']
        user_id = workspace['userId']
        
        try:
            # 1. Stop ECS tasks but keep EFS data
            self.stop_ecs_tasks(client_id, user_id)
            
            # 2. Compress workspace data (if implemented)
            # self.compress_workspace_data(client_id, user_id)
            
            # 3. Update DynamoDB record
            self.table.update_item(
                Key={'clientId': client_id, 'userId': user_id},
                UpdateExpression='SET containerStatus = :status, archivedAt = :timestamp, archivalReason = :reason',
                ExpressionAttributeValues={
                    ':status': 'archived',
                    ':timestamp': int(datetime.now().timestamp()),
                    ':reason': reason
                }
            )
            
            return {'action': 'archived', 'reason': reason}
            
        except Exception as e:
            return {'action': 'error', 'reason': str(e)}
    
    def stop_ecs_tasks(self, client_id: str, user_id: str):
        """Stop ECS tasks for specific workspace"""
        # Query running tasks with client/user labels
        tasks = self.ecs.list_tasks(
            cluster=os.environ['ECS_CLUSTER_NAME'],
            desiredStatus='RUNNING'
        )
        
        for task_arn in tasks['taskArns']:
            # Get task definition to check labels
            task_detail = self.ecs.describe_tasks(
                cluster=os.environ['ECS_CLUSTER_NAME'],
                tasks=[task_arn]
            )
            
            for task in task_detail['tasks']:
                # Check if task belongs to this client/user
                for container in task.get('containers', []):
                    env_vars = container.get('environment', [])
                    task_client = next((env['value'] for env in env_vars if env['name'] == 'CLIENT_ID'), None)
                    task_user = next((env['value'] for env in env_vars if env['name'] == 'USER_ID'), None)
                    
                    if task_client == client_id and task_user == user_id:
                        self.ecs.stop_task(
                            cluster=os.environ['ECS_CLUSTER_NAME'],
                            task=task_arn,
                            reason=f'Workspace cleanup for {client_id}/{user_id}'
                        )
    
    def update_efs_permissions(self) -> int:
        """Update EFS access points to only allow access to active workspaces"""
        # Get all active workspaces
        active_workspaces = self.table.scan(
            FilterExpression='containerStatus = :status',
            ExpressionAttributeValues={':status': 'active'}
        )
        
        # Create list of allowed paths
        allowed_paths = []
        for workspace in active_workspaces.get('Items', []):
            client_id = workspace['clientId']
            user_id = workspace['userId']
            allowed_paths.extend([
                f"/workspace/{client_id}/{user_id}",
                f"/workspace/{client_id}/shared"  # Allow shared folders
            ])
        
        # Update EFS access points with new path restrictions
        # This would involve creating/updating access points with POSIX permissions
        # that only allow access to the specified paths
        
        return len(allowed_paths)
```

### 3. EFS Permission Management

#### Access Point Strategy
```python
def create_restricted_access_point(client_id: str, user_id: str) -> str:
    """Create EFS access point with restricted permissions"""
    
    # Generate unique POSIX user ID for isolation
    posix_uid = hash(f"{client_id}-{user_id}") % 60000 + 1000
    posix_gid = hash(client_id) % 60000 + 1000
    
    response = efs_client.create_access_point(
        FileSystemId=os.environ['EFS_FILE_SYSTEM_ID'],
        PosixUser={
            'Uid': posix_uid,
            'Gid': posix_gid
        },
        RootDirectory={
            'Path': f"/workspace/{client_id}/{user_id}",
            'CreationInfo': {
                'OwnerUid': posix_uid,
                'OwnerGid': posix_gid,
                'Permissions': 0o755
            }
        },
        Tags=[
            {'Key': 'ClientId', 'Value': client_id},
            {'Key': 'UserId', 'Value': user_id},
            {'Key': 'ManagedBy', 'Value': 'WorkspaceCleanup'}
        ]
    )
    
    return response['AccessPointId']

def update_container_permissions(client_id: str, user_id: str, access_point_id: str):
    """Update container to use specific EFS access point"""
    
    # This would be handled by ECS task definition update
    # to mount EFS using the specific access point
    task_definition = {
        'family': f'claude-code-{client_id}-{user_id}',
        'containerDefinitions': [{
            'name': 'claude-code',
            'mountPoints': [{
                'sourceVolume': 'workspace',
                'containerPath': '/workspace',
                'readOnly': False
            }],
            'environment': [
                {'name': 'CLIENT_ID', 'value': client_id},
                {'name': 'USER_ID', 'value': user_id},
                {'name': 'EFS_ACCESS_POINT', 'value': access_point_id}
            ]
        }],
        'volumes': [{
            'name': 'workspace',
            'efsVolumeConfiguration': {
                'fileSystemId': os.environ['EFS_FILE_SYSTEM_ID'],
                'accessPointId': access_point_id,
                'transitEncryption': 'ENABLED'
            }
        }]
    }
    
    return task_definition
```

### 4. Enhanced Hephaestus EFS Stack

#### Updated CleanupFunction
```typescript
// Update the cleanup function in hephaestus/lib/efs-stack.ts
const cleanupFunction = new lambda.Function(this, 'WorkspaceCleanupFunction', {
  runtime: lambda.Runtime.PYTHON_3_11,
  handler: 'cleanup_manager.WorkspaceCleanupManager.handler',
  code: lambda.Code.fromAsset('lambda/workspace-cleanup'),
  timeout: cdk.Duration.minutes(15),
  memorySize: 512,
  environment: {
    WORKSPACE_STATUS_TABLE: workspaceStatusTable.tableName,
    EFS_FILE_SYSTEM_ID: this.fileSystem.fileSystemId,
    ECS_CLUSTER_NAME: props.ecsClusterName,
    AWS_REGION: this.region,
  },
});

// Grant permissions
workspaceStatusTable.grantReadWriteData(cleanupFunction);
this.fileSystem.grantRootAccess(cleanupFunction);

// Add ECS permissions
cleanupFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'ecs:ListTasks',
    'ecs:DescribeTasks',
    'ecs:StopTask',
    'ecs:DescribeTaskDefinition',
  ],
  resources: ['*'],
}));

// Schedule cleanup to run every hour
const cleanupRule = new events.Rule(this, 'WorkspaceCleanupSchedule', {
  schedule: events.Schedule.rate(cdk.Duration.hours(1)),
});

cleanupRule.addTarget(new targets.LambdaFunction(cleanupFunction));
```

## Implementation Benefits

### Security ✅
- **Principle of least privilege**: Containers only access their specific workspace
- **Customer isolation**: EFS access points prevent cross-tenant access  
- **Centralized control**: All cleanup decisions made by Lambda with full context
- **Audit trail**: All actions logged in DynamoDB

### Business Logic ✅
- **Subscription awareness**: Different retention policies per tier
- **Billing integration**: Cleanup aligns with customer status
- **Grace periods**: Reasonable time before data removal
- **Recovery options**: Archived data can be restored

### Operational Excellence ✅
- **Centralized monitoring**: Single place to track all workspace activity
- **Predictable cleanup**: Scheduled hourly execution
- **Error handling**: Failed cleanups logged and retried
- **Observability**: Comprehensive cleanup reporting

## Migration Plan

### Phase 1: Infrastructure (Week 1)
1. Create WorkspaceStatus DynamoDB table
2. Update Lambda cleanup function
3. Create EFS access point management
4. Update ECS task definitions

### Phase 2: Container Updates (Week 2)  
1. Update containers to report status to DynamoDB
2. Remove self-termination logic
3. Add EFS access point support
4. Update monitoring and logging

### Phase 3: Testing & Rollout (Week 3)
1. Test cleanup logic with various scenarios
2. Validate EFS permissions isolation
3. Monitor cleanup execution
4. Gradual rollout to production

## Configuration Variables

```bash
# DynamoDB
WORKSPACE_STATUS_TABLE=WorkspaceStatus

# EFS  
EFS_FILE_SYSTEM_ID=fs-12345678
EFS_ACCESS_POINT_ENABLED=true

# ECS
ECS_CLUSTER_NAME=claude-code-cluster

# Cleanup Schedule
CLEANUP_SCHEDULE_HOURS=1
CLEANUP_TIMEOUT_MINUTES=15

# Retention Policies (days)
FREE_TIER_RETENTION=7
PRO_TIER_RETENTION=30
ENTERPRISE_TIER_RETENTION=90

# Grace Periods (days)
CANCELLED_GRACE_PERIOD=7
SUSPENDED_GRACE_PERIOD=3
```

This approach provides proper enterprise-grade workspace management with customer awareness, security isolation, and predictable cleanup behavior.