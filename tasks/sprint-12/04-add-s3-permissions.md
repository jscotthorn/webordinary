# Task 04: Add S3 Permissions

## Objective
Add S3 permissions to the container task role via CDK so containers can sync built sites to S3 buckets.

## Context
Containers need to:
- Write to S3 buckets (edit.*.webordinary.com)
- List bucket contents for sync operations
- Delete old files during sync
- Optionally invalidate CloudFront (future)

Currently missing from `fargate-stack.ts` task role.

## Implementation Steps

### 1. Add S3 Permissions to Task Role

```typescript
// lib/fargate-stack.ts

// In the constructor, after creating taskRole, add S3 permissions

// Add S3 permissions for static site deployment
taskRole.addToPolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: [
      's3:PutObject',
      's3:PutObjectAcl',
      's3:GetObject',
      's3:GetObjectAcl',
      's3:DeleteObject',
      's3:ListBucket',
      's3:GetBucketLocation',
      's3:GetBucketAcl',
    ],
    resources: [
      // Bucket level permissions
      'arn:aws:s3:::edit.*.webordinary.com',
      // Object level permissions
      'arn:aws:s3:::edit.*.webordinary.com/*',
    ],
  })
);

// Add S3 permissions for reading Astro source (if needed)
taskRole.addToPolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: [
      's3:GetObject',
      's3:ListBucket',
    ],
    resources: [
      // Source bucket if templates are stored in S3
      'arn:aws:s3:::webordinary-templates',
      'arn:aws:s3:::webordinary-templates/*',
    ],
  })
);

// Add CloudFront invalidation permissions (for future use)
taskRole.addToPolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: [
      'cloudfront:CreateInvalidation',
      'cloudfront:GetInvalidation',
      'cloudfront:ListInvalidations',
    ],
    resources: [
      // Will need specific distribution ARNs when CloudFront is added
      '*', // Temporary, should be specific distribution ARNs
    ],
  })
);

// Add permissions to list S3 buckets (for dynamic bucket discovery)
taskRole.addToPolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: [
      's3:ListAllMyBuckets',
      's3:HeadBucket',
    ],
    resources: ['*'], // These actions only work with * resource
  })
);
```

### 2. Add Environment Variables for S3 Configuration

```typescript
// lib/fargate-stack.ts

// In container definition, add S3-related environment variables
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
    S3_REGION: this.region,
    // S3 sync options
    S3_SYNC_DELETE: 'true', // Delete files in S3 that don't exist locally
    S3_SYNC_ACL: 'public-read', // Make files publicly readable
    S3_SYNC_CACHE_CONTROL: 'max-age=3600', // 1 hour cache
    // Optional CloudFront settings (for future)
    CLOUDFRONT_DISTRIBUTION_ID: '', // Will be set when CloudFront is added
    CLOUDFRONT_INVALIDATE: 'false', // Disabled until CloudFront is added
  },
  secrets: {
    GITHUB_TOKEN: ecs.Secret.fromSecretsManager(githubSecret),
  },
});
```

### 3. Create S3 Bucket Policy Template

Create a template for S3 bucket policies that allow public read access:

```json
// scripts/s3-bucket-policy-template.json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::BUCKET_NAME/*"
    },
    {
      "Sid": "AllowContainerWrite",
      "Effect": "Allow",
      "Principal": {
        "AWS": "TASK_ROLE_ARN"
      },
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::BUCKET_NAME/*"
    }
  ]
}
```

### 4. Add Script to Verify Permissions

```bash
#!/bin/bash
# scripts/verify-s3-permissions.sh

PROFILE="personal"
CLUSTER="webordinary-edit-cluster"
SERVICE="webordinary-edit-service"

echo "Verifying S3 permissions for containers..."

# Get task role ARN
TASK_DEF=$(aws ecs describe-services \
  --cluster $CLUSTER \
  --services $SERVICE \
  --profile $PROFILE \
  --query "services[0].taskDefinition" \
  --output text)

TASK_ROLE=$(aws ecs describe-task-definition \
  --task-definition $TASK_DEF \
  --profile $PROFILE \
  --query "taskDefinition.taskRoleArn" \
  --output text)

echo "Task Role ARN: $TASK_ROLE"

# List attached policies
echo "Inline policies:"
aws iam list-role-policies \
  --role-name $(basename $TASK_ROLE) \
  --profile $PROFILE

# Get policy details
POLICY_NAME=$(aws iam list-role-policies \
  --role-name $(basename $TASK_ROLE) \
  --profile $PROFILE \
  --query "PolicyNames[0]" \
  --output text)

echo "Policy content:"
aws iam get-role-policy \
  --role-name $(basename $TASK_ROLE) \
  --policy-name $POLICY_NAME \
  --profile $PROFILE \
  --query "PolicyDocument" | jq .

# Test S3 access (requires running container)
echo "To test S3 access, run a container and execute:"
echo "aws s3 ls s3://edit.test.webordinary.com/"
echo "aws s3 cp test.txt s3://edit.test.webordinary.com/test.txt"
```

### 5. Deployment

```bash
# Build CDK
cd hephaestus
npm run build

# Review changes
npx cdk diff FargateStack --profile personal

# Deploy with new permissions
npx cdk deploy FargateStack --profile personal

# Verify deployment
./scripts/verify-s3-permissions.sh
```

### 6. Test S3 Access from Container

```bash
# Start a test container
aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --desired-count 1 \
  --profile personal

# Get task ARN
TASK_ARN=$(aws ecs list-tasks \
  --cluster webordinary-edit-cluster \
  --service-name webordinary-edit-service \
  --profile personal \
  --query "taskArns[0]" \
  --output text)

# Execute commands in container (using ECS Exec if enabled)
aws ecs execute-command \
  --cluster webordinary-edit-cluster \
  --task $TASK_ARN \
  --container webordinary-edit \
  --interactive \
  --command "/bin/bash" \
  --profile personal

# In container, test S3 access:
aws s3 ls
aws s3 ls s3://edit.amelia.webordinary.com/
echo "test" > /tmp/test.txt
aws s3 cp /tmp/test.txt s3://edit.amelia.webordinary.com/test.txt
aws s3 rm s3://edit.amelia.webordinary.com/test.txt
```

## Verification Checklist

- [ ] Task role has S3 permissions in IAM
- [ ] Container environment variables set correctly
- [ ] Container can list S3 buckets
- [ ] Container can write to edit.*.webordinary.com buckets
- [ ] Container can delete from S3 (for sync)
- [ ] Permissions are properly scoped (not using *)

## Security Considerations

1. **Least Privilege**: Only allow access to edit.* buckets
2. **No Production Access**: Don't allow access to production buckets
3. **Audit Trail**: CloudTrail logs all S3 operations
4. **Bucket Policies**: Each bucket should have appropriate policies
5. **Encryption**: Consider enabling S3 encryption at rest

## Rollback Plan

If permissions cause issues:
```bash
# Remove S3 permissions from task role
# Redeploy: npx cdk deploy FargateStack --profile personal
# Container will continue to function for other operations
```

## Acceptance Criteria

- [ ] S3 permissions added to task role via CDK
- [ ] Environment variables configured
- [ ] CDK deployed successfully
- [ ] Container can sync to S3
- [ ] Security review completed
- [ ] Documentation updated

## Time Estimate
1-2 hours

## Notes
- Start with broad permissions, then narrow down
- Consider S3 bucket versioning for rollback capability
- Monitor S3 costs as usage increases
- Plan for CloudFront integration in future sprint