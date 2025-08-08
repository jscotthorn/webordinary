# ⚠️ Task 04: Workspace Cleanup System - Important Update

## Issue Identified
The container self-termination approach implemented in Task 04 has significant **security and architectural concerns** that need to be addressed before production deployment.

## Problems with Current Approach ❌

### 1. Security Concerns
- **Containers self-terminating**: Unsafe pattern for production systems
- **Broad file system access**: Containers can access all workspace folders
- **No customer isolation**: Potential cross-tenant data access risks

### 2. Business Logic Gaps  
- **No subscription awareness**: Cannot consider billing status or tiers
- **No retention policies**: One-size-fits-all approach inadequate
- **No customer context**: Cannot handle suspended/cancelled accounts appropriately

### 3. Operational Issues
- **Race conditions**: Multiple containers making independent decisions
- **No centralized control**: Each container operates in isolation
- **Poor observability**: No centralized monitoring of workspace lifecycle

## Proposed Solution: DynamoDB-Driven Cleanup System ✅

### Architecture Overview
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Container     │───▶│   DynamoDB      │◀───│  Lambda Cron    │
│ (Reports Status)│    │ WorkspaceStatus │    │ (Cleanup Logic) │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │                        │
                              ▼                        ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │ Customer/Billing│    │  EFS Access     │
                       │    Integration  │    │    Points       │
                       └─────────────────┘    └─────────────────┘
```

### Key Components

#### 1. DynamoDB WorkspaceStatus Table
```json
{
  "clientId": "acme-corp",
  "userId": "john-doe", 
  "subscriptionStatus": "active|suspended|cancelled",
  "subscriptionTier": "free|pro|enterprise",
  "lastActivity": 1691234567,
  "containerStatus": "active|idle|terminated",
  "retentionDays": 30,
  "efsAccessPoint": "fsap-12345678"
}
```

#### 2. Business Rules Engine
```python
def determine_action(subscription_status, tier, idle_days):
    if subscription_status == 'cancelled' and idle_days > 7:
        return 'terminate'  # 7-day grace period
    elif subscription_status == 'suspended' and idle_days > 3:
        return 'archive'    # 3-day grace period
    elif tier == 'free' and idle_days > 7:
        return 'archive'    # Free tier: 7 days
    elif tier == 'pro' and idle_days > 30:
        return 'archive'    # Pro tier: 30 days
    elif tier == 'enterprise' and idle_days > 90:
        return 'archive'    # Enterprise: 90 days
    return 'active'
```

#### 3. EFS Access Point Isolation
```typescript
// Each client/user gets dedicated access point
const accessPoint = new efs.AccessPoint(this, 'UserAccessPoint', {
  fileSystem: this.fileSystem,
  path: `/workspace/${clientId}/${userId}`,
  posixUser: { uid: generateUID(clientId, userId), gid: 1000 },
  createAcl: { permissions: '0755' }
});
```

#### 4. Lambda Cleanup Function (Hourly Cron)
- **Query DynamoDB**: Get all workspace status records
- **Apply business rules**: Determine action based on subscription/activity
- **Update EFS permissions**: Only allow access to active workspaces
- **Manage container lifecycle**: Stop/start ECS tasks as needed

## Implementation Status

### ✅ Completed in Task 04
- Enhanced git operations with auto-commit/push
- RESTful API endpoints for git workflow
- Docker container with secure git authentication
- Basic activity tracking and logging

### ⚠️ Updated/Deprecated in Task 04  
- **Auto-shutdown script**: Marked as legacy, updated to report to DynamoDB
- **Container self-termination**: Disabled except for extended development idle
- **Broad EFS access**: Will be replaced with access points

### 🔄 Required for Production
- **DynamoDB table**: Workspace status tracking (in progress)
- **Lambda cleanup function**: Business rules engine (designed)
- **EFS access points**: Per-client isolation (architecture ready)
- **Container updates**: Remove self-termination, add DynamoDB reporting

## Migration Plan

### Phase 1: Infrastructure (Week 1)
1. ✅ **Design review completed** - DynamoDB schema and Lambda architecture
2. 🔄 **Deploy DynamoDB table** - WorkspaceStatus with GSI
3. 🔄 **Create Lambda function** - Cleanup logic with business rules
4. 🔄 **Update Hephaestus stack** - Add new resources

### Phase 2: Container Updates (Week 2)
1. 🔄 **Add DynamoDB SDK** to container
2. 🔄 **Update activity reporting** to DynamoDB instead of local files  
3. 🔄 **Remove self-termination logic** (keep for dev/test only)
4. 🔄 **Add EFS access point support**

### Phase 3: Integration & Testing (Week 3)
1. 🔄 **Test cleanup logic** with various subscription scenarios
2. 🔄 **Validate EFS permissions** and customer isolation
3. 🔄 **Monitor cleanup execution** and error handling
4. 🔄 **Production rollout** with gradual migration

## Configuration Updates Required

### Container Environment Variables
```bash
# New DynamoDB integration
WORKSPACE_STATUS_TABLE=WorkspaceStatus
AWS_REGION=us-west-2

# Customer/subscription context  
CLIENT_ID=acme-corp
USER_ID=john-doe
SUBSCRIPTION_STATUS=active
SUBSCRIPTION_TIER=pro

# EFS access point (instead of root access)
EFS_ACCESS_POINT=fsap-12345678
```

### Lambda Environment Variables
```bash
WORKSPACE_STATUS_TABLE=WorkspaceStatus
EFS_FILE_SYSTEM_ID=fs-12345678
ECS_CLUSTER_NAME=claude-code-cluster
RETENTION_POLICIES='{"free":7,"pro":30,"enterprise":90}'
```

## Risk Assessment

### High Priority Risks ⚠️
1. **Current prod deployment**: Container self-termination could cause unexpected shutdowns
2. **Data isolation**: Multiple customers could potentially access each other's workspaces
3. **Billing integration**: No connection to actual subscription status

### Medium Priority Risks
1. **Migration complexity**: Moving from file-based to DynamoDB-based status
2. **EFS performance**: Access points may introduce latency
3. **Lambda timeout**: Cleanup function processing many workspaces

### Mitigations ✅
1. **Feature flags**: Keep legacy behavior during transition
2. **Gradual rollout**: Test with subset of customers first
3. **Monitoring**: Comprehensive logging and alerting
4. **Rollback plan**: Can revert to current approach if issues

## Impact on Other Tasks

### Task 02 (Fargate Deployment)
- **Requires DynamoDB permissions** for container IAM role
- **Needs EFS access point configuration** instead of root file system access
- **Environment variable updates** for customer context

### Task 03 (Claude Code SDK)  
- **Git operations unchanged** - all enhancements remain valid
- **Activity reporting updated** - will report to DynamoDB
- **Workspace isolation benefits** - better security for customer data

## Next Actions Required

### Immediate (This Sprint)
1. **Review and approve** DynamoDB-driven approach
2. **Update Task 02** to include DynamoDB integration
3. **Implement Lambda cleanup function** in Hephaestus stack

### Future Sprint  
1. **Container migration** to DynamoDB status reporting
2. **EFS access point implementation** for customer isolation
3. **Production testing** and gradual rollout

## Conclusion

The workspace cleanup system update addresses critical security and scalability concerns identified in the initial Task 04 implementation. While the git operations and container functionality remain excellent, the lifecycle management approach needs this architectural improvement for production readiness.

The new approach provides:
- ✅ **Enterprise-grade security** with customer isolation
- ✅ **Business-aware cleanup** with subscription tiers
- ✅ **Centralized management** with proper observability  
- ✅ **Scalable architecture** for multi-tenant operations

**Recommendation**: Proceed with DynamoDB-driven cleanup system implementation before production deployment.