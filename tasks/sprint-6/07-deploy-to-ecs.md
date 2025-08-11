# Task 07: Deploy Updated Container to ECS

## Objective
Deploy the S3-enabled container to ECS and verify the complete email-to-S3 workflow.

## Context
After local testing succeeds, deploy to the actual ECS infrastructure and test with real email workflows.

## Deployment Steps

### 1. Build and Push to ECR
```bash
cd /Users/scott/Projects/webordinary/claude-code-container

# Build for linux/amd64
docker build --platform linux/amd64 -t webordinary/claude-code-astro:s3-deploy .

# Tag for ECR
docker tag webordinary/claude-code-astro:s3-deploy \
  942734823970.dkr.ecr.us-west-2.amazonaws.com/webordinary/claude-code-astro:s3-deploy

# Login to ECR
AWS_PROFILE=personal aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin 942734823970.dkr.ecr.us-west-2.amazonaws.com

# Push to ECR
docker push 942734823970.dkr.ecr.us-west-2.amazonaws.com/webordinary/claude-code-astro:s3-deploy
```

### 2. Update Task Definition via CDK
**Important**: Use Task 08 to update via CDK, not manually:
- S3 permissions added to task role
- Port mappings removed
- Health checks removed

```bash
# After CDK changes from Task 08 are deployed:
# The new task definition will be created automatically
# Just need to ensure service uses the latest revision
```

### 3. Update ECS Service
```bash
# Update service with new task definition
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --task-definition webordinary-edit-task:new-revision \
  --force-new-deployment

# Scale to 1 for testing
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --desired-count 1
```

### 4. Remove ALB Target Group (Optional)
Since containers no longer serve HTTP:
```bash
# Remove from target group if still attached
AWS_PROFILE=personal aws elbv2 deregister-targets \
  --target-group-arn arn:aws:elasticloadbalancing:... \
  --targets Id=...
```

## Testing

### 1. Monitor Deployment
```bash
# Watch service deployment
AWS_PROFILE=personal aws ecs describe-services \
  --cluster webordinary-edit-cluster \
  --services webordinary-edit-service \
  --query 'services[0].deployments'

# Check running tasks
AWS_PROFILE=personal aws ecs list-tasks \
  --cluster webordinary-edit-cluster \
  --service-name webordinary-edit-service
```

### 2. Check CloudWatch Logs
```bash
# View container logs
AWS_PROFILE=personal aws logs tail /ecs/webordinary/edit \
  --follow \
  --since 5m
```

### 3. Send Test Email
Send an email to trigger the workflow:
- To: appropriate email address
- Subject: triggers processing
- Body: "Update the homepage title"

### 4. Verify End-to-End
```bash
# Monitor SQS queue
AWS_PROFILE=personal aws sqs get-queue-attributes \
  --queue-url https://sqs.us-west-2.amazonaws.com/.../webordinary-email-queue \
  --attribute-names ApproximateNumberOfMessages

# Check S3 for updates
AWS_PROFILE=personal aws s3 ls s3://edit.amelia.webordinary.com/ \
  --recursive \
  --summarize

# Verify site updated
open http://edit.amelia.webordinary.com
```

## Rollback Plan
If issues occur:
```bash
# Revert to previous task definition
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --task-definition webordinary-edit-task:previous-revision

# Or scale to 0 to stop processing
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --desired-count 0
```

## Monitoring

### Key Metrics to Watch
- ECS task status (running/stopped)
- CloudWatch logs for errors
- S3 sync success/failure
- SQS message processing rate
- Site availability at edit domain

### Expected Behavior
1. Email received → Hermes processes
2. Message sent to container SQS queue
3. Container processes message
4. Astro builds in container
5. S3 sync executes
6. Site updates at edit.amelia.webordinary.com

## Acceptance Criteria
- [ ] Container deployed to ECS successfully
- [ ] No port/health check errors
- [ ] Email triggers container processing
- [ ] S3 sync works from ECS
- [ ] Site updates visible
- [ ] No ALB routing errors (since removed)

## Time Estimate
1-2 hours including testing

## Notes
- Keep previous task definition revision for rollback
- Monitor costs (container running time)
- Document any IAM permission issues
- Test with multiple messages for load