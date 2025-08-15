# Task 02: Deploy Fargate to Existing CDK Stack for Live-Edit Mode

## Overview
Extend the existing Hephaestus CDK stack to include AWS Fargate infrastructure for running Claude Code SDK and Astro dev server in a containerized environment with live-edit capabilities.

## Business Requirements
- Enable real-time content editing with instant preview (< 2s updates)
- Support concurrent editing sessions without interference
- Auto-scale to zero when idle to minimize costs
- Maintain existing production build pipeline

## Technical Requirements

### 1. Fargate Service Configuration
- **Cluster**: Create new ECS cluster `webordinary-edit-cluster`
- **Task Definition**:
  - CPU: 2048 (2 vCPU)
  - Memory: 4096 MB (4 GB)
  - Network mode: awsvpc
  - Task role: New IAM role with permissions for:
    - S3 read/write to workspace bucket
    - Secrets Manager access for API keys
    - CloudWatch Logs
    - GitHub API access

### 2. Container Configuration
- **Image**: Reference ECR repository from Task 00 exports
- **Ports**:
  - 4321: Astro dev server (HTTP)
  - 4322: Astro dev server (WebSocket for HMR)
  - 8080: API endpoint for Claude Code commands
- **Environment Variables**:
  ```typescript
  environment: {
    ASTRO_DEV_MODE: 'true',
    WORKSPACE_PATH: '/workspace',
    AUTO_SHUTDOWN_MINUTES: '5'
  }
  ```
- **Secrets** (from Task 00 Secrets Manager):
  - ANTHROPIC_API_KEY (from webordinary/anthropic-api-key)
  - GITHUB_TOKEN (from webordinary/github-token)

### 3. Application Load Balancer Integration
- **Target Groups**:
  - `edit-api-tg`: Port 8080 for API calls
  - `edit-preview-tg`: Port 4321 for Astro preview
  - `edit-ws-tg`: Port 4322 for WebSocket (HMR)
- **ALB Rules**:
  - `/api/*` → edit-api-tg
  - `/preview/*` → edit-preview-tg
  - `/ws/*` → edit-ws-tg (sticky sessions enabled)
- **Health Checks**:
  - Path: `/health`
  - Interval: 30 seconds
  - Timeout: 5 seconds

### 4. Auto-Scaling Configuration
- **Service Auto-Scaling**:
  - Min capacity: 0
  - Max capacity: 3
  - Desired count: 0 (scales from zero)
- **Scaling Policies**:
  - Scale up: When API request received
  - Scale down: After 5 minutes of inactivity
  - CPU target: 40%
  - Memory target: 60%

### 5. Persistent Storage (EFS from Task 00)
- **EFS Volume**: Import from Task 00 exports
  - Mount point: `/workspace`
  - Performance mode: General Purpose
  - Throughput mode: Bursting
  - Encryption: At rest with AWS managed key
- **Directory Structure**:
  ```
  /workspace/
  ├── {clientId}/
  │   └── {userId}/           # User workspace
  │       ├── project/        # Single git repo (all branches)
  │       │   ├── .git/       # All thread branches
  │       │   ├── node_modules/ # Shared dependencies
  │       │   └── .astro/     # Shared build cache
  │       ├── .claude/        # Claude state
  │       │   ├── threads/    # Thread contexts
  │       │   └── user.json   # User preferences
  │       └── metadata.json   # Workspace metadata
  ```
- **Benefits**:
  - **90% storage reduction** (one repo vs N copies)
  - **Shared node_modules** across all threads
  - **Shared build cache** for faster rebuilds
  - **Git branch isolation** per thread
  - **Natural thread history** via git log

### 6. CloudFront Behavior Updates
Add new behaviors to existing CloudFront distribution:
```typescript
behaviors: [
  {
    pathPattern: '/api/*',
    targetOriginId: 'alb-origin',
    viewerProtocolPolicy: 'redirect-to-https',
    allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
    compress: true,
    cachePolicyId: 'no-cache-policy'
  },
  {
    pathPattern: '/preview/*',
    targetOriginId: 'alb-origin',
    viewerProtocolPolicy: 'redirect-to-https',
    allowedMethods: ['GET', 'HEAD'],
    compress: false, // Don't compress HTML for HMR
    cachePolicyId: 'no-cache-policy'
  }
]
```

### 7. DNS Configuration
- Add CNAME record: `edit.ameliastamps.com` → ALB DNS name
- Certificate: Use existing ACM wildcard cert `*.ameliastamps.com`

## CDK Implementation Structure

```typescript
// lib/fargate-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export class FargateEditStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FargateEditStackProps) {
    super(scope, id, props);

    // Import resources from Task 00
    const ecrRepo = ecr.Repository.fromRepositoryArn(
      this,
      'ECRRepo',
      cdk.Fn.importValue('ClaudeCodeAstroRepoArn')
    );
    
    const anthropicSecret = secretsmanager.Secret.fromSecretArn(
      this,
      'AnthropicSecret',
      cdk.Fn.importValue('AnthropicApiKeyArn')
    );
    
    const githubSecret = secretsmanager.Secret.fromSecretArn(
      this,
      'GitHubSecret', 
      cdk.Fn.importValue('GitHubTokenArn')
    );

    const alb = elbv2.ApplicationLoadBalancer.fromLoadBalancerArn(
      this,
      'ALB',
      cdk.Fn.importValue('WebordinaryALBArn')
    );

    // Import EFS from Task 00
    const fileSystemId = cdk.Fn.importValue('WorkspaceEFSId');
    const fileSystem = efs.FileSystem.fromFileSystemAttributes(
      this,
      'WorkspaceEFS',
      {
        fileSystemId,
        securityGroup: ec2.SecurityGroup.fromSecurityGroupId(
          this,
          'EFSSecurityGroup',
          'sg-efs' // Will be created/imported
        ),
      }
    );

    // 1. Create ECS Cluster
    const cluster = new ecs.Cluster(this, 'EditCluster', {
      clusterName: 'webordinary-edit-cluster',
      vpc // Use default VPC or import
    });

    // 2. Create Task Definition with EFS support
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'EditTask', {
      cpu: 2048,
      memoryLimitMiB: 4096,
      taskRole: editTaskRole,
      executionRole: editExecutionRole,
      volumes: [
        {
          name: 'workspace',
          efsVolumeConfiguration: {
            fileSystemId: fileSystem.fileSystemId,
            transitEncryption: 'ENABLED',
            authorizationConfig: {
              accessPointId: cdk.Fn.importValue('ClientAccessPointId'), // From Task 00
              iam: 'ENABLED',
            },
          },
        },
      ],
    });

    // 3. Add Container with EFS mount
    const container = taskDefinition.addContainer('claude-code-astro', {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
      environment: {
        ASTRO_DEV_MODE: 'true',
        WORKSPACE_PATH: '/workspace',
        AUTO_SHUTDOWN_MINUTES: '5',
        CLIENT_ID: 'ameliastamps', // Will be dynamic via API
        USER_ID: 'scott', // Will be dynamic via API  
        DEFAULT_REPO: 'https://github.com/jscotthorn/amelia-astro.git',
      },
      secrets: {
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(anthropicSecret),
        GITHUB_TOKEN: ecs.Secret.fromSecretsManager(githubSecret),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'edit',
        logRetention: 7
      }),
      mountPoints: [
        {
          containerPath: '/workspace',
          sourceVolume: 'workspace',
          readOnly: false,
        },
      ],
    });

    // 4. Create Service
    const service = new ecs.FargateService(this, 'EditService', {
      cluster,
      taskDefinition,
      desiredCount: 0,
      assignPublicIp: false,
      platformVersion: ecs.FargatePlatformVersion.LATEST
    });

    // 5. Configure Auto-scaling
    const scaling = service.autoScaleTaskCount({
      minCapacity: 0,
      maxCapacity: 3
    });

    // 6. Add to ALB from Task 00
    const listener = alb.listeners[0]; // HTTPS listener
    // ... target group configuration
  }
}
```

## Acceptance Criteria
1. ✅ Fargate service deploys successfully with CDK
2. ✅ Container starts and passes health checks
3. ✅ Auto-scaling from zero works (< 30s cold start)
4. ✅ WebSocket connections maintained for HMR
5. ✅ EFS volume persists workspace between restarts
6. ✅ Costs < $10/month at 10 hours usage
7. ✅ CloudFront behaviors route correctly to ALB
8. ✅ DNS resolution works for edit.ameliastamps.com

## Dependencies
- ECR repository and ALB from Task 00
- Docker image built and pushed from Task 01  
- Secrets Manager configured from Task 00
- Existing Hephaestus CDK stack

## Testing Plan
1. Deploy stack to development environment
2. Test container startup and health checks
3. Verify auto-scaling triggers
4. Test WebSocket connectivity for HMR
5. Validate EFS persistence across restarts
6. Load test with 3 concurrent sessions
7. Monitor CloudWatch metrics and costs

## Rollback Plan
- CDK stack can be destroyed independently
- No impact on existing Lambda build pipeline
- CloudFront behaviors can be removed without affecting production

## Estimated Effort
- Development: 2 days
- Testing: 0.5 days
- Documentation: 0.5 days
- **Total: 3 days**