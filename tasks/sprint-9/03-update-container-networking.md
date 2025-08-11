# Task 03: Update Container Networking

## Objective
Simplify container networking by removing web serving configurations, port mappings, and unnecessary security group rules.

## Context
Containers currently have:
- Port 8080 exposed for web serving
- Health checks on HTTP endpoints
- Security group ingress rules for ALB
- Service discovery configurations

All of these can be removed since containers only process messages and sync to S3.

## Implementation Steps

### 1. Update Task Definition (Remove Port Mappings)

```typescript
// lib/fargate-stack.ts

// In the constructor, update task definition and container
this.taskDefinition = new ecs.FargateTaskDefinition(this, 'EditTaskDef', {
  family: 'webordinary-edit-task',
  memoryLimitMiB: 4096,
  cpu: 2048,
  executionRole,
  taskRole,
  // REMOVED: No port mappings needed
});

// Update container definition
const container = this.taskDefinition.addContainer('EditContainer', {
  containerName: 'webordinary-edit',
  image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
  logging,
  environment: {
    NODE_ENV: 'production',
    LOG_LEVEL: 'info',
    WORKSPACE_PATH: '/workspace',
    EFS_MOUNT_PATH: '/workspace',
    // S3 configuration
    S3_BUCKET_PREFIX: 'edit',
    S3_BUCKET_SUFFIX: 'webordinary.com',
  },
  secrets: {
    GITHUB_TOKEN: ecs.Secret.fromSecretsManager(githubSecret),
  },
  // REMOVED: portMappings: [{ containerPort: 8080, protocol: ecs.Protocol.TCP }]
  // REMOVED: healthCheck - no HTTP endpoint to check
});
```

### 2. Update Security Groups

```typescript
// lib/fargate-stack.ts

// Create minimal security group for containers
const containerSecurityGroup = new ec2.SecurityGroup(this, 'ContainerSecurityGroup', {
  vpc,
  description: 'Security group for edit containers (message processing only)',
  allowAllOutbound: true, // Still need for S3, GitHub, SQS, etc.
});

// Only allow EFS access (remove all web-related ingress)
const efsSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
  this,
  'ImportedEFSSecurityGroup',
  efsSecurityGroupId
);

// Allow container to access EFS
containerSecurityGroup.addIngressRule(
  ec2.Peer.ipv4(vpc.vpcCidrBlock),
  ec2.Port.tcp(2049),
  'EFS mount traffic'
);

// Allow EFS to receive connections from containers
efsSecurityGroup.addIngressRule(
  containerSecurityGroup,
  ec2.Port.tcp(2049),
  'EFS access from containers'
);

// REMOVED: No ingress on port 8080
// REMOVED: No ALB security group rules
```

### 3. Update Service Configuration

```typescript
// lib/fargate-stack.ts

this.service = new ecs.FargateService(this, 'EditService', {
  cluster: this.cluster,
  taskDefinition: this.taskDefinition,
  serviceName: 'webordinary-edit-service',
  desiredCount: 0, // Scale to zero when not in use
  assignPublicIp: true, // Need for outbound internet (S3, GitHub)
  vpcSubnets: {
    subnets: vpc.publicSubnets, // Use public subnets for internet access
  },
  securityGroups: [containerSecurityGroup],
  // REMOVED: healthCheckGracePeriod - no health checks
  // REMOVED: No target group registration
  // REMOVED: No service discovery
  enableLogging: true,
  logDriver: new ecs.AwsLogDriver({
    streamPrefix: 'edit-service',
    logRetention: logs.RetentionDays.ONE_WEEK,
  }),
});

// REMOVED: No target group attachment
// REMOVED: No service registry
```

### 4. Remove Service Discovery (if present)

```typescript
// Check if service discovery is configured and remove it

// REMOVED: Service discovery namespace
// const namespace = new servicediscovery.PrivateDnsNamespace(this, 'Namespace', {
//   name: 'webordinary.local',
//   vpc,
// });

// REMOVED: Service registry in service configuration
// cloudMapOptions: {
//   name: 'edit-service',
//   namespace,
// }
```

### 5. Update Container Auto-Scaling (if present)

```typescript
// Simplify auto-scaling - only based on SQS messages, not requests

const scaling = this.service.autoScaleTaskCount({
  minCapacity: 0,
  maxCapacity: 5,
});

// Scale based on SQS queue depth only
scaling.scaleOnMetric('QueueDepthScaling', {
  metric: new cloudwatch.Metric({
    namespace: 'AWS/SQS',
    metricName: 'ApproximateNumberOfMessagesVisible',
    dimensionsMap: {
      QueueName: 'webordinary-email-queue',
    },
    statistic: 'Average',
  }),
  scalingSteps: [
    { upper: 0, change: -1 },    // Scale down to 0 if no messages
    { lower: 1, change: +1 },     // Scale up if messages present
    { lower: 10, change: +2 },    // Scale up more if queue backs up
  ],
  adjustmentType: autoscaling.AdjustmentType.CHANGE_IN_CAPACITY,
  cooldown: cdk.Duration.minutes(5),
});

// REMOVED: CPU/Memory based scaling (was for web serving)
// REMOVED: Request count based scaling
```

### 6. Deployment Commands

```bash
# Build the CDK app
cd hephaestus
npm run build

# Check changes
npx cdk diff FargateStack --profile personal

# Deploy the updated stack
npx cdk deploy FargateStack --profile personal

# Monitor deployment
aws ecs describe-services \
  --cluster webordinary-edit-cluster \
  --services webordinary-edit-service \
  --profile personal
```

### 7. Verification

```bash
# Verify no port mappings
aws ecs describe-task-definition \
  --task-definition webordinary-edit-task \
  --profile personal \
  --query "taskDefinition.containerDefinitions[0].portMappings"
# Should return empty array or null

# Check security groups
aws ec2 describe-security-groups \
  --group-ids <container-sg-id> \
  --profile personal \
  --query "SecurityGroups[0].IpPermissions"
# Should only show EFS port 2049

# Verify service has no target groups
aws ecs describe-services \
  --cluster webordinary-edit-cluster \
  --services webordinary-edit-service \
  --profile personal \
  --query "services[0].loadBalancers"
# Should return empty array
```

## Testing After Changes

1. **Container Can Start**
```bash
# Force a deployment to test new configuration
aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --force-new-deployment \
  --desired-count 1 \
  --profile personal

# Check task status
aws ecs list-tasks \
  --cluster webordinary-edit-cluster \
  --profile personal
```

2. **Container Can Process Messages**
```bash
# Send test message via SQS
# Verify container processes it
# Check S3 for output
```

3. **No Network Errors**
```bash
# Check CloudWatch logs for errors
aws logs tail /ecs/webordinary/edit --follow --profile personal
```

## Rollback Plan

If issues occur:
1. Restore port mappings in task definition
2. Re-add security group rules
3. Redeploy with `npx cdk deploy FargateStack`

## Acceptance Criteria

- [ ] Port 8080 mapping removed
- [ ] Health checks removed
- [ ] Security group simplified (only EFS)
- [ ] Service discovery removed (if present)
- [ ] Auto-scaling simplified to SQS only
- [ ] Container can still start
- [ ] Container can process messages
- [ ] Container can access S3 and GitHub

## Time Estimate
2-3 hours

## Notes
- Containers become true "workers" - no web serving
- Simpler architecture = fewer failure points
- Network isolation improves security
- Monitor for any connectivity issues to AWS services