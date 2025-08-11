# Task 02: Decommission Session Router Lambda

## Objective
Remove the SessionRoutingStack and Lambda function that was routing requests to containers, as this is no longer needed with S3 static hosting.

## Context
The session router Lambda was:
- Routing preview URLs to specific containers
- Looking up sessions in DynamoDB
- Handling WebSocket upgrade attempts
- Managing container wake scenarios

All of this is now obsolete with S3 static hosting.

## Implementation Steps

### 1. Remove SessionRoutingStack from CDK

```bash
# First, check what will be destroyed
cd hephaestus
npx cdk destroy SessionRoutingStack --profile personal --dry-run

# Remove the stack
npx cdk destroy SessionRoutingStack --profile personal
```

### 2. Remove Stack Files

```bash
# Remove the stack implementation
rm lib/session-routing-stack.ts
rm lib/session-routing-stack.js
rm lib/session-routing-stack.d.ts

# Remove Lambda function code
rm -rf lambdas/session-router/
```

### 3. Update Main App File

```typescript
// bin/hephaestus.ts

import * as cdk from 'aws-cdk-lib';
import { ALBStack } from '../lib/alb-stack';
import { FargateStack } from '../lib/fargate-stack';
import { HermesStack } from '../lib/hermes-stack';
// REMOVED: import { SessionRoutingStack } from '../lib/session-routing-stack';
// ... other imports

const app = new cdk.App();

// ... other stacks ...

// ALB Stack (simplified, no routing)
const albStack = new ALBStack(app, 'ALBStack', {
  env,
  description: 'ALB for Webordinary (simplified - no container routing)',
});

// REMOVED: Session Routing Stack
// const sessionRoutingStack = new SessionRoutingStack(app, 'SessionRoutingStack', {
//   env,
//   httpsListener: albStack.httpsListener,
// });

// Update stack dependencies
fargateStack.addDependency(albStack);
// REMOVED: fargateStack.addDependency(sessionRoutingStack);
```

### 4. Clean Up CloudWatch Resources

```bash
# Delete Lambda log group
aws logs delete-log-group \
  --log-group-name /aws/lambda/session-router \
  --profile personal

# List and remove Lambda metrics alarms
aws cloudwatch describe-alarms \
  --alarm-name-prefix "session-router" \
  --profile personal

# Delete any found alarms
aws cloudwatch delete-alarms \
  --alarm-names "session-router-errors" "session-router-duration" \
  --profile personal
```

### 5. Clean Up IAM Resources

```bash
# The IAM role should be deleted with the stack, but verify
aws iam list-roles \
  --query "Roles[?contains(RoleName, 'SessionRouter')]" \
  --profile personal

# If any remain, they'll be cleaned up in Task 06
```

### 6. Update Cross-Stack References

Check and update any stacks that might reference the session router:

```typescript
// lib/monitoring-stack.ts - Remove Lambda metrics

private createLambdaMetricsWidget(): cloudwatch.GraphWidget {
  // Remove session-router metrics
  return new cloudwatch.GraphWidget({
    title: 'Lambda Function Metrics',
    left: [
      // REMOVED: Session router metrics
      // Keep other Lambda metrics if any
    ],
  });
}

private createLambdaAlarms(): void {
  // REMOVED: Session router alarms
  // const sessionRouterErrorAlarm = new cloudwatch.Alarm(...)
}
```

### 7. Verification Steps

```bash
# Verify Lambda function is gone
aws lambda list-functions \
  --query "Functions[?contains(FunctionName, 'SessionRouter')]" \
  --profile personal
# Should return empty array

# Verify stack is deleted
aws cloudformation describe-stacks \
  --stack-name SessionRoutingStack \
  --profile personal
# Should return error: Stack not found

# Check ALB listener rules
aws elbv2 describe-rules \
  --listener-arn <listener-arn> \
  --profile personal
# Should only show default rule
```

## Cleanup Checklist

- [ ] SessionRoutingStack destroyed via CDK
- [ ] Stack files removed from codebase
- [ ] Lambda function deleted
- [ ] CloudWatch log group removed
- [ ] Metrics and alarms cleaned up
- [ ] IAM role removed
- [ ] Cross-stack references updated
- [ ] Main app file updated

## Testing After Removal

1. **CDK Synth Works**
```bash
npx cdk synth --profile personal
# Should complete without errors
```

2. **No Orphaned Resources**
```bash
# Check for orphaned Lambda functions
aws lambda list-functions --profile personal | grep -i session

# Check for orphaned log groups
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda" --profile personal
```

3. **Container Operations Unaffected**
```bash
# Send test message to container
# Verify it processes without Lambda router
```

## Rollback Plan

If the Lambda is still needed:
1. Restore from git:
```bash
git checkout HEAD -- lib/session-routing-stack.ts
git checkout HEAD -- lambdas/session-router/
```

2. Redeploy:
```bash
npx cdk deploy SessionRoutingStack --profile personal
```

## Cost Savings

Removing the session router Lambda will save:
- Lambda invocations: ~$2/month
- CloudWatch Logs: ~$0.50/month
- Lambda concurrent executions: Frees up quota
- Reduced complexity: Priceless

## Acceptance Criteria

- [ ] SessionRoutingStack successfully destroyed
- [ ] Lambda function no longer exists
- [ ] CloudWatch logs cleaned up
- [ ] No errors in remaining stacks
- [ ] CDK synth completes successfully
- [ ] Container processing still works

## Time Estimate
1-2 hours

## Notes
- The Lambda was handling complex routing logic that's no longer needed
- DynamoDB tables for session tracking remain (still used by containers)
- Keep documentation of what the Lambda did for historical reference
- Monitor for any unexpected errors after removal