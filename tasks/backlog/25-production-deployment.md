# Task 25: Production Deployment and Gradual Rollout

## Objective
Deploy the new multi-session SQS architecture to production with a gradual rollout strategy to minimize risk and ensure smooth transition.

## Deployment Strategy

### Phase 1: Canary Deployment (Week 1)
- Deploy to 5% of traffic
- Monitor closely for issues
- Quick rollback capability

### Phase 2: Progressive Rollout (Week 2)
- Increase to 25%, then 50%
- A/B testing with metrics comparison
- Gather user feedback

### Phase 3: Full Deployment (Week 3)
- Roll out to 100% of traffic
- Decommission old architecture
- Final optimization

## Pre-Deployment Checklist

### Infrastructure
- [ ] All CDK stacks deployed
- [ ] DynamoDB tables created with indexes
- [ ] SQS queues configured with DLQs
- [ ] CloudWatch dashboards active
- [ ] Alerts configured and tested

### Code
- [ ] Container image built and pushed to ECR
- [ ] All tests passing (unit, integration, load)
- [ ] Security scan completed
- [ ] Performance benchmarks met
- [ ] Documentation updated

### Operations
- [ ] Runbooks reviewed with team
- [ ] On-call schedule updated
- [ ] Rollback plan documented
- [ ] Monitoring access granted
- [ ] Support team trained

## Deployment Steps

### Step 1: Deploy Infrastructure

```bash
#!/bin/bash
# deploy-infrastructure.sh

set -e

echo "Deploying Webordinary SQS Architecture..."

# Deploy core stacks
cd hephaestus
npx cdk deploy WebordinaryECRStack --require-approval never
npx cdk deploy WebordinarySecretsStack --require-approval never
npx cdk deploy WebordinaryEFSStack --require-approval never
npx cdk deploy WebordinaryALBStack --require-approval never

# Deploy new SQS and session stacks
npx cdk deploy WebordinarySQSStack --require-approval never
npx cdk deploy WebordinarySessionStack --require-approval never

# Deploy updated Fargate stack
npx cdk deploy WebordinaryFargateStack --require-approval never

# Deploy monitoring
npx cdk deploy WebordinaryMonitoringStack --require-approval never

echo "Infrastructure deployed successfully"
```

### Step 2: Deploy Container Image

```bash
#!/bin/bash
# deploy-container.sh

set -e

# Build container
cd claude-code-container
docker build -t webordinary/edit-container:${VERSION} .

# Tag for ECR
docker tag webordinary/edit-container:${VERSION} \
  ${ECR_REPO}/webordinary/edit-container:${VERSION}

docker tag webordinary/edit-container:${VERSION} \
  ${ECR_REPO}/webordinary/edit-container:latest

# Push to ECR
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin ${ECR_REPO}

docker push ${ECR_REPO}/webordinary/edit-container:${VERSION}
docker push ${ECR_REPO}/webordinary/edit-container:latest

# Update task definition
aws ecs register-task-definition \
  --family webordinary-edit-task \
  --container-definitions "[{
    \"name\": \"edit-container\",
    \"image\": \"${ECR_REPO}/webordinary/edit-container:${VERSION}\"
  }]"

echo "Container deployed successfully"
```

### Step 3: Canary Deployment

```typescript
// canary-deployment.ts
export class CanaryDeployment {
  async deployCanary(percentage: number = 5) {
    console.log(`Starting canary deployment at ${percentage}%`);
    
    // Update ALB weighted target groups
    await this.updateTargetGroupWeights({
      oldVersion: 100 - percentage,
      newVersion: percentage
    });
    
    // Monitor metrics
    const metrics = await this.monitorCanary();
    
    if (metrics.errorRate > 0.01) {
      console.error('High error rate detected, rolling back');
      await this.rollback();
      return false;
    }
    
    console.log('Canary deployment successful');
    return true;
  }
  
  async progressiveRollout() {
    const stages = [5, 25, 50, 75, 100];
    
    for (const percentage of stages) {
      console.log(`Rolling out to ${percentage}%`);
      
      const success = await this.deployCanary(percentage);
      if (!success) {
        console.error(`Rollout failed at ${percentage}%`);
        return false;
      }
      
      // Wait and monitor
      await this.waitAndMonitor(percentage);
    }
    
    console.log('Full rollout complete');
    return true;
  }
  
  async updateTargetGroupWeights(weights: Weights) {
    await this.elbv2.send(new ModifyRuleCommand({
      RuleArn: this.ruleArn,
      Actions: [{
        Type: 'forward',
        ForwardConfig: {
          TargetGroups: [
            {
              TargetGroupArn: this.oldTargetGroupArn,
              Weight: weights.oldVersion
            },
            {
              TargetGroupArn: this.newTargetGroupArn,
              Weight: weights.newVersion
            }
          ]
        }
      }]
    }));
  }
}
```

### Step 4: Feature Flags

```typescript
// feature-flags.ts
export class FeatureFlags {
  private flags = new Map<string, boolean>();
  
  constructor() {
    // Production feature flags
    this.flags.set('use_sqs_architecture', false);
    this.flags.set('enable_interrupt_handling', false);
    this.flags.set('enable_session_resumption', false);
  }
  
  async enableFeature(feature: string, percentage: number = 100) {
    // Store in DynamoDB for persistence
    await this.dynamodb.send(new PutItemCommand({
      TableName: 'webordinary-feature-flags',
      Item: {
        feature: { S: feature },
        enabled: { BOOL: true },
        percentage: { N: percentage.toString() },
        updatedAt: { S: new Date().toISOString() }
      }
    }));
    
    // Update local cache
    this.flags.set(feature, true);
    
    console.log(`Feature ${feature} enabled at ${percentage}%`);
  }
  
  isEnabled(feature: string, userId?: string): boolean {
    if (!this.flags.get(feature)) {
      return false;
    }
    
    if (userId) {
      // Check if user is in rollout percentage
      const hash = this.hashUser(userId);
      const percentage = this.getFeaturePercentage(feature);
      return hash <= percentage;
    }
    
    return true;
  }
}
```

### Step 5: Monitoring During Deployment

```typescript
// deployment-monitor.ts
export class DeploymentMonitor {
  private metrics: DeploymentMetrics = {
    errorRate: 0,
    responseTime: 0,
    successRate: 0,
    containerStarts: 0,
    dlqMessages: 0
  };
  
  async monitor(duration: number = 3600000) {
    const startTime = Date.now();
    const interval = setInterval(async () => {
      await this.collectMetrics();
      await this.checkThresholds();
      
      if (Date.now() - startTime > duration) {
        clearInterval(interval);
      }
    }, 60000); // Check every minute
  }
  
  private async collectMetrics() {
    // Collect from CloudWatch
    const metrics = await this.cloudWatch.send(new GetMetricStatisticsCommand({
      Namespace: 'Webordinary/Production',
      MetricName: 'ErrorRate',
      StartTime: new Date(Date.now() - 300000), // Last 5 minutes
      EndTime: new Date(),
      Period: 300,
      Statistics: ['Average']
    }));
    
    this.metrics.errorRate = metrics.Datapoints?.[0]?.Average || 0;
    
    // Collect other metrics...
  }
  
  private async checkThresholds() {
    if (this.metrics.errorRate > 0.05) {
      await this.alert('High error rate during deployment');
      await this.initiateRollback();
    }
    
    if (this.metrics.dlqMessages > 0) {
      await this.alert('Messages in DLQ during deployment');
    }
    
    if (this.metrics.responseTime > 10000) {
      await this.alert('Slow response times during deployment');
    }
  }
}
```

### Step 6: Rollback Plan

```bash
#!/bin/bash
# rollback.sh

set -e

echo "INITIATING EMERGENCY ROLLBACK"

# Stop new container deployments
aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --desired-count 0

# Revert ALB routing
aws elbv2 modify-rule \
  --rule-arn ${RULE_ARN} \
  --actions Type=forward,TargetGroupArn=${OLD_TARGET_GROUP_ARN}

# Restore old task definition
aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --task-definition webordinary-edit-task:${PREVIOUS_VERSION}

# Scale up old service
aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --desired-count ${PREVIOUS_COUNT}

# Disable feature flags
aws dynamodb put-item \
  --table-name webordinary-feature-flags \
  --item '{"feature": {"S": "use_sqs_architecture"}, "enabled": {"BOOL": false}}'

echo "Rollback completed"

# Send notification
aws sns publish \
  --topic-arn ${ALERT_TOPIC_ARN} \
  --subject "Production Rollback Completed" \
  --message "The production deployment has been rolled back successfully"
```

## Post-Deployment

### Validation
```bash
#!/bin/bash
# validate-deployment.sh

# Test health endpoints
curl -f https://edit.ameliastamps.webordinary.com/health || exit 1

# Test session creation
SESSION_ID=$(curl -X POST https://api.webordinary.com/sessions \
  -H "Content-Type: application/json" \
  -d '{"clientId": "test", "userId": "deploy-test"}' | jq -r '.sessionId')

# Test message processing
curl -X POST https://api.webordinary.com/sessions/${SESSION_ID}/messages \
  -H "Content-Type: application/json" \
  -d '{"instruction": "Test deployment"}'

# Check metrics
aws cloudwatch get-metric-statistics \
  --namespace Webordinary/Production \
  --metric-name SuccessRate \
  --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average

echo "Deployment validation passed"
```

### Cleanup
```bash
# Remove old infrastructure
aws cloudformation delete-stack --stack-name webordinary-old-stack

# Delete old container images
aws ecr batch-delete-image \
  --repository-name webordinary/edit-container \
  --image-ids imageTag=old-version

# Archive old code
git tag -a pre-sqs-architecture -m "Archive before SQS migration"
git push origin pre-sqs-architecture
```

## Success Criteria
- [ ] Zero downtime during deployment
- [ ] Error rate < 0.1%
- [ ] Response times maintained
- [ ] All sessions migrated successfully
- [ ] Rollback tested and working
- [ ] Monitoring shows healthy metrics

## Communication Plan
1. **Pre-deployment**: Email users about upcoming improvements
2. **During deployment**: Status page updates
3. **Post-deployment**: Success notification and new features guide
4. **If rollback**: Incident report and next steps

## Lessons Learned Documentation
- Document any issues encountered
- Update runbooks with new procedures
- Share knowledge with team
- Plan improvements for next deployment