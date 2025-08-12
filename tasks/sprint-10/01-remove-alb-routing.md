# Task 01: Remove ALB Web Routing

## Objective
Remove ALB listener rules, target groups, and health checks since containers no longer serve web traffic.

## Context
The ALB currently has:
- HTTPS listener on port 443
- HTTP redirect from port 80
- Certificate for *.webordinary.com
- Security groups allowing web traffic
- Target group configurations (need removal)
- Health check configurations (need removal)

We'll keep the ALB itself for potential future use but remove all container routing.

## Implementation Steps

### 1. Update ALB Stack

```typescript
// lib/alb-stack.ts

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';

export class ALBStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly httpsListener: elbv2.ApplicationListener;
  // REMOVED: public sessionRouterLambda?: lambda.Function;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Use default VPC
    const vpc = ec2.Vpc.fromLookup(this, 'VPC', {
      isDefault: true,
    });

    // Simplified Security Group (no container routing needed)
    const albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
      vpc,
      description: 'Security group for ALB (simplified - no container routing)',
      allowAllOutbound: false, // Restrict outbound since no backend targets
    });

    // Create ALB
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'WebordinaryALB', {
      vpc,
      internetFacing: true,
      loadBalancerName: 'webordinary-edit-alb',
      securityGroup: albSecurityGroup,
    });

    // Keep certificate for future use
    const certificate = new acm.Certificate(this, 'WebordinaryCert', {
      domainName: '*.webordinary.com',
      subjectAlternativeNames: ['webordinary.com'],
      validation: acm.CertificateValidation.fromDns(),
    });

    // Simplified HTTPS listener - just returns info page
    this.httpsListener = this.alb.addListener('HttpsListener', {
      port: 443,
      certificates: [certificate],
      defaultAction: elbv2.ListenerAction.fixedResponse(200, {
        contentType: 'text/html',
        messageBody: `
          <!DOCTYPE html>
          <html>
          <head><title>Webordinary Infrastructure</title></head>
          <body>
            <h1>Webordinary ALB</h1>
            <p>This load balancer is currently not routing traffic.</p>
            <p>Edit sites are served directly from S3:</p>
            <ul>
              <li><a href="http://edit.amelia.webordinary.com">edit.amelia.webordinary.com</a></li>
            </ul>
            <p>Status: Operational | Architecture: S3 Static Hosting</p>
          </body>
          </html>
        `,
      }),
    });

    // Keep HTTP redirect
    this.alb.addListener('HttpListener', {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    });

    // Minimal security group rules (just web traffic)
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'HTTP access'
    );
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'HTTPS access'
    );

    // Keep outputs for potential future use
    new cdk.CfnOutput(this, 'ALBArn', {
      value: this.alb.loadBalancerArn,
      exportName: 'WebordinaryALBArn',
    });

    new cdk.CfnOutput(this, 'ALBDnsName', {
      value: this.alb.loadBalancerDnsName,
      exportName: 'WebordinaryALBDnsName',
    });

    // Note: Removed HTTPSListenerArn export as it's no longer needed
  }
}
```

### 2. Update Fargate Stack

Remove ALB target group and health checks:

```typescript
// lib/fargate-stack.ts - Key changes

export class FargateStack extends cdk.Stack {
  // ... existing code ...

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    // ... existing setup ...

    // REMOVE: ALB listener import (no longer needed)
    // REMOVE: Dummy security group for ALB

    // Update Task Definition - Remove port mappings
    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'EditTaskDef', {
      family: 'webordinary-edit-task',
      memoryLimitMiB: 4096,
      cpu: 2048,
      executionRole,
      taskRole,
      // REMOVED: Port mappings
    });

    // Update Container Definition - No port mappings
    const container = this.taskDefinition.addContainer('EditContainer', {
      containerName: 'webordinary-edit',
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
      logging,
      environment: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        // Add S3 bucket configuration
        S3_BUCKET_PREFIX: 'edit',
        S3_BUCKET_SUFFIX: 'webordinary.com',
      },
      secrets: {
        GITHUB_TOKEN: ecs.Secret.fromSecretsManager(githubSecret),
      },
      // REMOVED: portMappings
      // REMOVED: healthCheck
    });

    // Update Service - No target group or health checks
    this.service = new ecs.FargateService(this, 'EditService', {
      cluster: this.cluster,
      taskDefinition: this.taskDefinition,
      serviceName: 'webordinary-edit-service',
      desiredCount: 0, // Scale to zero when not in use
      assignPublicIp: true, // Still need for outbound internet
      // REMOVED: healthCheckGracePeriod
      // REMOVED: target group registration
    });

    // Update Security Group - Remove ingress rules
    const containerSecurityGroup = new ec2.SecurityGroup(this, 'ContainerSecurityGroup', {
      vpc,
      description: 'Security group for edit containers (no web serving)',
      allowAllOutbound: true, // Need for S3, GitHub, etc.
    });

    // Only add EFS ingress (remove port 8080)
    containerSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(2049),
      'EFS mount'
    );

    this.service.connections.addSecurityGroup(containerSecurityGroup);

    // REMOVED: Target group creation
    // REMOVED: Listener rule for routing
  }
}
```

### 3. Deployment Steps

```bash
# 1. First verify S3 serving is working
curl -I http://edit.amelia.webordinary.com

# 2. Build CDK
cd hephaestus
npm run build

# 3. Check what will change
npx cdk diff ALBStack --profile personal
npx cdk diff FargateStack --profile personal

# 4. Deploy changes
npx cdk deploy FargateStack --profile personal
npx cdk deploy ALBStack --profile personal

# 5. Verify ALB no longer routes to containers
curl https://webordinary-edit-alb-xxx.elb.amazonaws.com
# Should see the info page, not container content
```

### 4. Verification

```bash
# Check ALB listeners
aws elbv2 describe-listeners \
  --load-balancer-arn arn:aws:elasticloadbalancing:us-west-2:xxx \
  --profile personal

# Verify no target groups
aws elbv2 describe-target-groups \
  --load-balancer-arns arn:aws:elasticloadbalancing:us-west-2:xxx \
  --profile personal

# Check container service has no target group
aws ecs describe-services \
  --cluster webordinary-edit-cluster \
  --services webordinary-edit-service \
  --profile personal
```

## Rollback Plan

If issues arise:
1. Keep backup of original CDK code
2. Redeploy with original configuration
3. Container functionality unaffected (just no web serving)

## Testing

1. Verify containers still process messages
2. Confirm S3 deployments work
3. Check ALB returns info page
4. Ensure no routing errors in logs

## Acceptance Criteria
- [ ] ALB listener rules removed
- [ ] Target groups deleted
- [ ] Health checks removed
- [ ] Container port mappings removed
- [ ] Security group rules updated
- [ ] CDK deployed successfully
- [ ] S3 serving still works

## Time Estimate
2-3 hours

## Notes
- Keep ALB for potential future use (CloudFront origin, etc.)
- Certificate remains for HTTPS when needed
- Document removed components for team
- Monitor for any unexpected errors