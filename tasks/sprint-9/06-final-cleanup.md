# Task 06: Final Cleanup Verification

## Objective
Identify and remove all orphaned resources, document the final architecture, and verify cost savings.

## Context
After removing ALB routing, Lambda functions, and container web serving, there may be:
- Orphaned security groups
- Unused IAM roles
- Stale CloudWatch log groups
- Unused network resources
- Old CloudFormation stacks

## Cleanup Checklist

### 1. Security Groups

```bash
# List all security groups with "webordinary" in name
aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=*webordinary*" \
  --profile personal \
  --query "SecurityGroups[].{Name:GroupName,ID:GroupId,InUse:length(IpPermissions)}"

# Check for unused security groups (no instances attached)
aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=*webordinary*" \
  --profile personal \
  --query "SecurityGroups[?length(IpPermissions)==\`0\`].{Name:GroupName,ID:GroupId}"

# Delete unused security groups
# aws ec2 delete-security-group --group-id sg-xxxxx --profile personal
```

### 2. IAM Roles and Policies

```bash
# List all IAM roles with "webordinary" or "session" in name
aws iam list-roles \
  --profile personal \
  --query "Roles[?contains(RoleName, 'webordinary') || contains(RoleName, 'Session')].RoleName"

# Check for orphaned Lambda execution roles
aws iam list-roles \
  --profile personal \
  --query "Roles[?contains(RoleName, 'SessionRouter')].RoleName"

# Delete orphaned roles (after detaching policies)
# aws iam delete-role --role-name RoleName --profile personal
```

### 3. CloudWatch Log Groups

```bash
# List all log groups
aws logs describe-log-groups \
  --log-group-name-prefix "/aws" \
  --profile personal \
  --query "logGroups[?contains(logGroupName, 'webordinary') || contains(logGroupName, 'session')].logGroupName"

# Identify orphaned log groups
echo "Log groups to potentially delete:"
echo "/aws/lambda/session-router"
echo "/aws/lambda/ALBStack-SessionRouter"
echo "/ecs/webordinary-web" # Old web serving logs

# Delete orphaned log groups
# aws logs delete-log-group --log-group-name /aws/lambda/session-router --profile personal
```

### 4. CloudFormation Stacks

```bash
# List all stacks
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE DELETE_FAILED \
  --profile personal \
  --query "StackSummaries[].{Name:StackName,Status:StackStatus}" \
  --output table

# Check for orphaned stacks
# - SessionRoutingStack (should be deleted)
# - Any test stacks

# Delete orphaned stacks
# aws cloudformation delete-stack --stack-name StackName --profile personal
```

### 5. Network Resources

```bash
# Check for unused elastic IPs
aws ec2 describe-addresses \
  --profile personal \
  --query "Addresses[?AssociationId==null]"

# Check for unused NAT gateways (expensive!)
aws ec2 describe-nat-gateways \
  --filter "Name=state,Values=available" \
  --profile personal

# Check for unused network interfaces
aws ec2 describe-network-interfaces \
  --filters "Name=description,Values=*webordinary*" \
  --profile personal \
  --query "NetworkInterfaces[?Status=='available']"
```

### 6. ECR Repository Cleanup

```bash
# List ECR images
aws ecr describe-images \
  --repository-name webordinary/claude-code-astro \
  --profile personal \
  --query "imageDetails[].{Tags:imageTags,Pushed:imagePushedAt}" \
  --output table

# Set lifecycle policy to keep only recent images
cat > ecr-lifecycle-policy.json << 'EOF'
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Keep last 10 images",
      "selection": {
        "tagStatus": "any",
        "countType": "imageCountMoreThan",
        "countNumber": 10
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
EOF

aws ecr put-lifecycle-policy \
  --repository-name webordinary/claude-code-astro \
  --lifecycle-policy-text file://ecr-lifecycle-policy.json \
  --profile personal
```

### 7. S3 Bucket Cleanup

```bash
# List all S3 buckets
aws s3 ls --profile personal | grep webordinary

# Check for old/unused buckets
# - CloudFormation template buckets
# - Old backup buckets
# - Test buckets

# Enable lifecycle policies for edit buckets
cat > s3-lifecycle-policy.json << 'EOF'
{
  "Rules": [
    {
      "Id": "DeleteOldVersions",
      "Status": "Enabled",
      "NoncurrentVersionExpiration": {
        "NoncurrentDays": 30
      }
    },
    {
      "Id": "CleanupIncompleteMultipart",
      "Status": "Enabled",
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 7
      }
    }
  ]
}
EOF

# Apply to edit buckets
aws s3api put-bucket-lifecycle-configuration \
  --bucket edit.amelia.webordinary.com \
  --lifecycle-configuration file://s3-lifecycle-policy.json \
  --profile personal
```

## Final Architecture Documentation

### What Remains

```yaml
Infrastructure:
  Compute:
    - ECS Cluster: webordinary-edit-cluster
    - Fargate Service: webordinary-edit-service (scales 0-5)
    - ECR Repository: webordinary/claude-code-astro
  
  Storage:
    - EFS: Workspace persistence
    - S3: edit.*.webordinary.com (static hosting)
    - DynamoDB: Session and container tables
  
  Messaging:
    - SQS: webordinary-email-queue
    - SQS: webordinary-email-dlq
    - SES: Email processing rules
  
  Networking:
    - VPC: Default VPC
    - Security Groups: Container SG (minimal)
    - No ALB routing
    - No port exposures
  
  Monitoring:
    - CloudWatch Dashboards
    - SNS Alert Topics
    - Custom Metrics

Removed:
  - ALB listener rules and target groups
  - Lambda session router
  - Container port 8080 exposure
  - Health check endpoints
  - Service discovery
  - Complex networking rules
```

### Cost Analysis

```bash
# Get cost breakdown for the last month
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity MONTHLY \
  --metrics "UnblendedCost" \
  --group-by Type=DIMENSION,Key=SERVICE \
  --filter file://cost-filter.json \
  --profile personal

# cost-filter.json
{
  "Tags": {
    "Key": "Project",
    "Values": ["Webordinary"]
  }
}
```

### Expected Monthly Savings

| Resource | Before | After | Savings |
|----------|--------|-------|---------|
| ALB Rules | $5 | $0 | $5 |
| Lambda Invocations | $2 | $0 | $2 |
| CloudWatch Logs | $5 | $3 | $2 |
| Network Transfer | $10 | $5 | $5 |
| **Total** | **$22** | **$8** | **$14/month** |

## Validation Script

Create a comprehensive validation script:

```bash
#!/bin/bash
# scripts/validate-cleanup.sh

echo "=== Webordinary Infrastructure Validation ==="
echo ""

# Check what's running
echo "✓ Active ECS Services:"
aws ecs list-services --cluster webordinary-edit-cluster --profile personal

echo ""
echo "✓ Active CloudFormation Stacks:"
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --profile personal \
  --query "StackSummaries[?contains(StackName, 'Stack')].StackName" \
  --output text

echo ""
echo "✓ S3 Static Hosting Buckets:"
aws s3 ls --profile personal | grep "edit.*webordinary"

echo ""
echo "✗ Removed Components:"
echo "  - Lambda functions: $(aws lambda list-functions --profile personal --query "Functions[?contains(FunctionName, 'SessionRouter')]" --output text | wc -l) (should be 0)"
echo "  - ALB target groups: $(aws elbv2 describe-target-groups --profile personal --query "TargetGroups[?contains(TargetGroupName, 'edit')]" --output text | wc -l) (should be 0)"
echo "  - Port 8080 mappings: $(aws ecs describe-task-definition --task-definition webordinary-edit-task --profile personal --query "taskDefinition.containerDefinitions[0].portMappings" --output text | wc -l) (should be 0)"

echo ""
echo "=== Cleanup Complete ==="
```

## Final Checklist

- [ ] Security groups reviewed and cleaned
- [ ] IAM roles reviewed and cleaned
- [ ] CloudWatch log groups cleaned
- [ ] CloudFormation stacks verified
- [ ] Network resources checked
- [ ] ECR lifecycle policy set
- [ ] S3 lifecycle policies configured
- [ ] Cost analysis completed
- [ ] Architecture documented
- [ ] Validation script runs clean

## Post-Cleanup Actions

1. **Update Documentation**
   - Update README with new architecture
   - Document removed components
   - Update deployment guides

2. **Team Communication**
   - Notify team of changes
   - Update runbooks
   - Schedule architecture review

3. **Monitor for Issues**
   - Watch CloudWatch for errors
   - Monitor S3 deployments
   - Check container performance

## Acceptance Criteria

- [ ] All orphaned resources identified
- [ ] Unnecessary resources deleted
- [ ] Cost savings verified
- [ ] Architecture documented
- [ ] No impact to functionality
- [ ] Clean validation script output

## Time Estimate
1-2 hours

## Notes
- Keep detailed list of deleted resources
- Some resources may have dependencies - delete in order
- CloudFormation stacks should handle most cleanup automatically
- Monitor costs for a full month to verify savings