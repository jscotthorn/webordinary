# Infrastructure (Hephaestus) Refactor Checklist

## Priority 1: Remove ALB Web Routing

- [ ] Remove ALB rules for `/session/*`
- [ ] Remove ALB rules for `/_astro/*`
- [ ] Remove ALB rules for `/ws/*`
- [ ] Remove ALB rules for `/preview/*`
- [ ] Keep only `/hermes/health` routing
- [ ] Remove WebSocket target groups
- [ ] Update listener configurations

## Priority 2: Clean Target Groups

- [ ] Remove container web target groups
- [ ] Keep only health check target groups
- [ ] Update health check paths
- [ ] Remove port 8080 references
- [ ] Simplify security group rules

## Priority 3: Update Stack Definitions

### FargateStack
- [ ] Remove port 8080 from task definition
- [ ] Remove web server environment variables
- [ ] Update container health checks (CloudWatch only)
- [ ] Clean up IAM permissions (remove ALB permissions)

### ALBStack
- [ ] Simplify to health checks only
- [ ] Remove complex routing rules
- [ ] Update security groups
- [ ] Clean up listener rules

### HermesStack
- [ ] Verify health check configuration
- [ ] Ensure queue permissions
- [ ] Check DynamoDB permissions
- [ ] Validate ECS permissions

## Priority 4: Update CDK Code

```typescript
// Remove patterns like:
listener.addTargets('WebTarget', {
  port: 8080,
  protocol: ApplicationProtocol.HTTP,
  targets: [service],
  healthCheck: {
    path: '/api/health'
  }
});

// Keep only:
listener.addTargets('HealthTarget', {
  port: 3000,
  protocol: ApplicationProtocol.HTTP,
  targets: [hermesService],
  healthCheck: {
    path: '/hermes/health'
  }
});
```

## Priority 5: Clean Environment Variables

- [ ] Remove WEB_PORT
- [ ] Remove WEBSOCKET_PORT
- [ ] Remove EXPRESS_PORT
- [ ] Keep SQS queue URLs
- [ ] Keep S3 bucket configurations
- [ ] Keep AWS credentials

## Priority 6: Documentation

- [ ] Update README.md architecture section
- [ ] Remove "Upcoming Changes" that are complete
- [ ] Clean routing configuration docs
- [ ] Update deployment commands
- [ ] Fix CLAUDE.md notes

## Stack Dependencies to Verify

```
1. ECRStack (no changes needed)
2. SecretsStack (no changes needed)
3. EFSStack (no changes needed)
4. ALBStack (major simplification)
5. SessionStack (verify tables)
6. FargateStack (remove web config)
7. HermesStack (health check only)
8. SqsStack (verify queues)
```

## CDK Commands to Test

```bash
# Build TypeScript
npm run build

# Check what will change
npx cdk diff --all --profile personal

# Deploy specific stack
npx cdk deploy ALBStack --profile personal
npx cdk deploy FargateStack --profile personal

# Verify synthesis
npx cdk synth
```

## AWS Console Checks

1. **ALB Rules**
   - Should only have default and /hermes/* rules
   - No /session/*, /_astro/*, /ws/* rules

2. **Target Groups**
   - Only health check targets
   - No port 8080 targets

3. **ECS Task Definitions**
   - No port mappings for 8080
   - CloudWatch log configuration

4. **Security Groups**
   - Remove inbound 8080 rules
   - Keep health check ports only

## Testing After Changes

```bash
# Check Hermes health
curl https://[alb-dns]/hermes/health

# Verify no web routes
curl https://[alb-dns]/session/test  # Should 404

# Check S3 site works
curl https://edit.amelia.webordinary.com

# Monitor services
AWS_PROFILE=personal aws ecs describe-services \
  --cluster webordinary-edit-cluster \
  --services webordinary-edit-service webordinary-hermes-service
```

## Success Criteria

- [ ] ALB only routes health checks
- [ ] No port 8080 anywhere
- [ ] S3 serves all web content
- [ ] Services deploy successfully
- [ ] Health checks pass
- [ ] Costs reduced (no unnecessary targets)

## Rollback Plan

1. Keep stack snapshots before changes
2. Test in dev environment first
3. Deploy incrementally (one stack at a time)
4. Monitor CloudWatch for errors
5. Have CDK destroy/recreate ready if needed