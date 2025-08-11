# Sprint 9 Task 1: ALB Web Routing Removal

## Completed: 2025-01-11

### What Was Accomplished

1. **ALB Stack Removed from AWS**
   - Successfully destroyed ALB stack using CloudFormation
   - Confirmed complete removal with `aws cloudformation describe-stacks`
   - No longer consuming AWS resources (~$30/month savings)

2. **ALB Stack Code Preserved**
   - Kept `/lib/alb-stack.ts` in codebase (simplified version without session routing)
   - Stack can be redeployed if needed in future
   - Removed from CDK app deployment list (not in `bin/hephaestus.ts`)

3. **Hermes Stack Updated**
   - Removed all ALB dependencies and HTTP endpoints
   - Removed port mappings (no longer serves port 3000)
   - Updated health check to use process monitoring instead of HTTP
   - Removed security group rules for HTTP traffic
   - Removed target groups and listener rules
   - Now operates as pure SQS message processor

4. **Session Routing Stack Preserved**
   - Kept `/lib/session-routing-stack.ts` for reference
   - Not instantiated or deployed
   - Lambda function code preserved in case needed later

### Architecture Changes

**Before:**
- ALB → Lambda (session routing) → Target Groups → Containers
- Hermes served HTTP endpoints on port 3000
- Complex routing rules based on session IDs

**After:**
- No ALB deployed (saves ~$30/month)
- All sites served from S3 with CloudFront
- Hermes processes SQS messages only (no HTTP)
- Containers deploy directly to S3 buckets

### Files Modified

1. `/hephaestus/lib/hermes-stack.ts`
   - Removed elbv2 import
   - Removed port mappings
   - Removed ALB target group and listener configuration
   - Updated health check from HTTP to process check
   - Removed security group inbound rules

2. `/hephaestus/bin/hephaestus.ts`
   - Re-enabled HermesStack deployment
   - Removed ALB dependency from Hermes
   - Added Hermes dependency to MonitoringStack

### Deployment Commands

```bash
# Verify ALB is removed
AWS_PROFILE=personal aws cloudformation describe-stacks --stack-name ALBStack
# Should return error: Stack does not exist

# Deploy Hermes without ALB (when ready)
AWS_PROFILE=personal npx cdk deploy HermesStack

# Scale Hermes up/down as needed
AWS_PROFILE=personal aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-hermes-service \
  --desired-count 1  # or 0 to stop
```

### Testing Status

- ✅ CDK builds successfully
- ✅ Hermes stack can be created without ALB
- ✅ ALB stack successfully removed from AWS
- ⏳ Hermes deployment not tested (requires container image)

### What Remains

1. **Deploy Hermes** when container image is ready
2. **Update monitoring** to remove ALB-related metrics
3. **Update documentation** to reflect S3-only architecture
4. **Consider removing** unused session routing Lambda code later

### Cost Savings

- ALB: ~$30/month eliminated
- Data transfer: Reduced (no ALB processing)
- Total monthly savings: ~$30-35

### Recommendations

1. **Keep ALB code** in repository for potential future use
2. **Deploy Hermes** only when actively processing emails
3. **Scale to zero** when not in use to maximize savings
4. **Monitor SQS queues** to ensure messages are processed