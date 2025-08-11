# Sprint 9: Infrastructure Cleanup & Optimization

## Sprint Goal
Remove obsolete infrastructure components after transitioning to S3 static hosting and optimize the remaining infrastructure.

## Sprint Overview
**Duration**: 1 week  
**Focus**: Infrastructure cleanup and CDK optimization  
**Outcome**: Simplified infrastructure with only essential components

## Context
After implementing S3 static hosting (Sprint 6-7) and testing (Sprint 8), we need to:
- Remove ALB listener rules and routing logic
- Decommission Lambda session router
- Remove container web serving infrastructure
- Update monitoring for new architecture
- Add S3 permissions to containers via CDK
- Clean up unused resources

## Current State Analysis
Based on CDK review:
- **ALB Stack**: Still has HTTPS listener, certificate, security groups
- **Session Routing Stack**: Lambda function for routing (can be removed)
- **Fargate Stack**: Still has health checks, port 8080 mappings, ALB target groups
- **Monitoring Stack**: Dashboards include Lambda metrics (needs update)
- **Missing**: S3 permissions in container task role

## Task Breakdown

### Infrastructure Removal Tasks

1. **[Task 01: Remove ALB Web Routing](01-remove-alb-routing.md)** (2-3 hours)
   - Remove ALB listener rules for edit domains
   - Remove target groups for containers
   - Keep ALB for future use but simplify configuration
   - Update CDK to remove health check configurations

2. **[Task 02: Decommission Session Router Lambda](02-remove-lambda-router.md)** (1-2 hours)
   - Remove SessionRoutingStack entirely
   - Clean up Lambda function and associated IAM roles
   - Remove Lambda permissions for DynamoDB
   - Update any cross-stack references

3. **[Task 03: Update Container Networking](03-update-container-networking.md)** (2-3 hours)
   - Remove port 8080 mappings from task definition
   - Remove container health checks
   - Update security groups (remove ingress rules)
   - Remove service discovery if present

4. **[Task 04: Add S3 Permissions](04-add-s3-permissions.md)** (1-2 hours)
   - Add S3 write permissions to task role
   - Scope permissions to edit.*.webordinary.com buckets
   - Add CloudFront invalidation permissions (optional)
   - Test permissions with actual deployment

5. **[Task 05: Update Monitoring](05-update-monitoring.md)** (2-3 hours)
   - Remove Lambda metrics from dashboard
   - Remove ALB target health metrics
   - Add S3 sync success/failure metrics
   - Update alarms for new architecture
   - Add build time and deployment metrics

6. **[Task 06: Final Cleanup](06-final-cleanup.md)** (1-2 hours)
   - Remove unused security groups
   - Clean up unused IAM roles
   - Remove orphaned CloudWatch log groups
   - Document remaining infrastructure
   - Cost analysis before/after

## CDK Deployment Strategy

### Order of Operations
1. First deploy additions (S3 permissions)
2. Then remove dependencies (Lambda router)
3. Finally remove parent resources (ALB rules)

### Deployment Commands
```bash
# Build and check changes
npm run build
npx cdk diff --all --profile personal

# Deploy S3 permissions first
npx cdk deploy FargateStack --profile personal

# Remove Lambda router
npx cdk destroy SessionRoutingStack --profile personal

# Update ALB and monitoring
npx cdk deploy ALBStack MonitoringStack --profile personal

# Verify all stacks
npx cdk list --profile personal
```

## Success Criteria
- [ ] ALB no longer routing to containers
- [ ] Lambda router removed
- [ ] Container networking simplified
- [ ] S3 permissions working
- [ ] Monitoring updated for S3 architecture
- [ ] All obsolete resources removed
- [ ] Cost reduction verified

## Risk Mitigation
| Risk | Impact | Mitigation |
|------|--------|------------|
| Removing active resources | Service disruption | Verify S3 serving working first |
| Missing permissions | Deployment failures | Test S3 permissions thoroughly |
| Monitoring gaps | Missed issues | Update dashboards before removal |
| Rollback needed | Extended downtime | Keep backup of CDK code |

## Cost Savings Expected
- **ALB Target Groups**: ~$5/month
- **Lambda Invocations**: ~$2/month
- **CloudWatch Logs**: ~$3/month
- **NAT Gateway (if removed)**: ~$45/month
- **Total Monthly Savings**: ~$10-55/month

## Infrastructure After Cleanup

### What Remains
- ECS Cluster for container orchestration
- Fargate tasks for Claude/build operations
- ECR for container images
- EFS for workspace persistence
- DynamoDB for session management
- SQS for message queuing
- S3 buckets for static hosting
- Route53 for DNS

### What's Removed
- ALB listener rules and target groups
- Lambda session router
- Container port mappings
- Health check configurations
- Unnecessary security group rules
- Service discovery entries

## Testing After Changes
1. Deploy test container with new permissions
2. Verify S3 sync works
3. Confirm no ALB routing errors
4. Check monitoring dashboards
5. Validate cost reduction in billing

## Notes
- Keep ALB infrastructure for potential future use
- Document all removed components
- Save CDK code history for rollback
- Consider further optimizations in future sprints

## Next Steps (Future Sprints)
- Implement CloudFront for HTTPS (Sprint 10)
- Add automated S3 bucket creation (Sprint 11)
- Implement blue-green deployments (Sprint 12)
- Add container auto-scaling policies (Sprint 13)