# Task 08: Update CDK for S3 Permissions and Container Changes

## Objective
Update the CDK infrastructure code to grant containers S3 write permissions and remove web serving configurations.

## Context
All infrastructure changes must be made through CDK to maintain infrastructure as code. This includes IAM permissions, task definitions, and service configurations.

## CDK Changes Required

### 1. Add S3 Permissions to Task Role
Location: `hephaestus/lib/fargate-stack.ts` (or similar)

```typescript
import * as iam from 'aws-cdk-lib/aws-iam';

// In the stack constructor, find or create the task role
const editTaskRole = new iam.Role(this, 'EditTaskRole', {
  assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
  description: 'Role for edit containers to access S3',
});

// Add S3 permissions for edit buckets
editTaskRole.addToPolicy(new iam.PolicyStatement({
  sid: 'S3EditBucketAccess',
  effect: iam.Effect.ALLOW,
  actions: [
    's3:PutObject',
    's3:PutObjectAcl',
    's3:GetObject',
    's3:DeleteObject',
    's3:ListBucket',
    's3:GetBucketLocation'
  ],
  resources: [
    'arn:aws:s3:::edit.*.webordinary.com',
    'arn:aws:s3:::edit.*.webordinary.com/*'
  ]
}));

// Also need basic S3 list permissions
editTaskRole.addToPolicy(new iam.PolicyStatement({
  sid: 'S3BasicAccess',
  effect: iam.Effect.ALLOW,
  actions: ['s3:ListAllMyBuckets'],
  resources: ['*']
}));
```

### 2. Update Task Definition
Remove port mappings since we're not serving HTTP anymore:

```typescript
const editTaskDefinition = new ecs.FargateTaskDefinition(this, 'EditTaskDef', {
  memoryLimitMiB: 4096,
  cpu: 2048,
  taskRole: editTaskRole,  // Use the role with S3 permissions
  executionRole: executionRole,
});

const container = editTaskDefinition.addContainer('edit-container', {
  image: ecs.ContainerImage.fromEcrRepository(
    ecrRepo,
    's3-deploy'  // New tag without web server
  ),
  logging: ecs.LogDrivers.awsLogs({
    streamPrefix: 'edit',
    logGroup: logGroup,
  }),
  environment: {
    AWS_REGION: 'us-west-2',
    // Remove PORT: '8080' if it exists
  },
  // Remove portMappings - no longer needed
  // portMappings: [{ containerPort: 8080 }], // DELETE THIS
});

// Remove health check if it exists
// healthCheck: { ... } // DELETE THIS
```

### 3. Update Service Configuration
Remove target group and load balancer associations:

```typescript
const editService = new ecs.FargateService(this, 'EditService', {
  cluster: cluster,
  taskDefinition: editTaskDefinition,
  desiredCount: 0,  // Scale to 0 by default for cost savings
  assignPublicIp: true,  // Needed for S3 access
  // Remove these if they exist:
  // healthCheckGracePeriod: Duration.seconds(60), // DELETE
  // targetGroups: [...], // DELETE
});

// Remove any ALB target group attachments
// No longer needed since we're not serving HTTP
```

### 4. Remove ALB Listener Rules (Optional)
If cleaning up old infrastructure:

```typescript
// In ALB stack, remove or comment out:
// - Listener rules for edit domains
// - Target groups for edit containers
// These can be removed in a later sprint
```

### 5. Add S3 Bucket Creation (Optional for now)
Since we're doing manual S3 setup for PoC, but for reference:

```typescript
// Future automation (not for Sprint 6)
const editBucket = new s3.Bucket(this, 'EditAmeliaBucket', {
  bucketName: 'edit.amelia.webordinary.com',
  websiteIndexDocument: 'index.html',
  websiteErrorDocument: '404.html',
  publicReadAccess: true,
  blockPublicAccess: {
    blockPublicAcls: false,
    blockPublicPolicy: false,
    ignorePublicAcls: false,
    restrictPublicBuckets: false,
  },
});
```

## Deployment Steps

### 1. Test CDK Changes
```bash
cd hephaestus
npm run build
npx cdk diff FargateStack  # Review changes
```

### 2. Deploy Changes
```bash
# Deploy with explicit approval
npx cdk deploy FargateStack --require-approval broadening

# Or if multiple stacks affected
npx cdk deploy --all --require-approval broadening
```

### 3. Verify Deployment
```bash
# Check task role has S3 permissions
AWS_PROFILE=personal aws iam get-role-policy \
  --role-name [task-role-name] \
  --policy-name [policy-name]

# Verify task definition updated
AWS_PROFILE=personal aws ecs describe-task-definition \
  --task-definition webordinary-edit-task \
  --query 'taskDefinition.taskRoleArn'
```

## Testing
After CDK deployment:
1. Container should be able to write to S3
2. No port binding errors
3. No health check failures
4. Check CloudWatch logs for permission errors

## Rollback
If issues occur:
```bash
# CDK keeps previous versions
npx cdk deploy FargateStack --rollback

# Or manually update task definition to previous revision
```

## Acceptance Criteria
- [ ] S3 permissions added to task role via CDK
- [ ] Port mappings removed from task definition
- [ ] Health checks removed
- [ ] CDK deployment successful
- [ ] Container can write to S3 buckets
- [ ] No manual IAM changes made

## Time Estimate
1-2 hours including testing

## Notes
- All changes through CDK for repeatability
- Keep infrastructure as code principles
- Test in dev before production
- Document any CDK version issues