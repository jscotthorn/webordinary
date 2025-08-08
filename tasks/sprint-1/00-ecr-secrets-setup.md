# Task 00: ECR Repository, Secrets Manager, and EFS Setup

## Overview
Create foundational AWS resources required by subsequent tasks: ECR repository for Docker images, Secrets Manager entries for API keys, and EFS filesystem for persistent client workspaces. This is a prerequisite for all container-based tasks.

## Business Requirements
- Secure storage for sensitive API keys
- Container registry for Docker images
- Persistent storage for client workspaces and build caches
- Foundation for subsequent infrastructure tasks
- Zero downtime setup

## Technical Requirements

### 1. ECR Repository Creation

#### CDK Implementation
```typescript
// lib/ecr-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';

export class ECRStack extends cdk.Stack {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create ECR repository
    this.repository = new ecr.Repository(this, 'ClaudeCodeAstroRepo', {
      repositoryName: 'webordinary/claude-code-astro',
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE,
      lifecycleRules: [
        {
          description: 'Keep last 10 images',
          maxImageCount: 10,
          rulePriority: 1,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Keep on stack deletion
    });

    // Grant pull permissions to Fargate execution role (will be created later)
    // This will be linked in Task 02

    // Output repository URI
    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: this.repository.repositoryUri,
      description: 'ECR Repository URI',
      exportName: 'ClaudeCodeAstroRepoUri',
    });

    // Output repository ARN for cross-stack reference
    new cdk.CfnOutput(this, 'RepositoryArn', {
      value: this.repository.repositoryArn,
      description: 'ECR Repository ARN',
      exportName: 'ClaudeCodeAstroRepoArn',
    });
  }
}
```

#### Manual Creation (Alternative)
```bash
# Create ECR repository via AWS CLI
aws ecr create-repository \
  --repository-name webordinary/claude-code-astro \
  --image-scanning-configuration scanOnPush=true \
  --region us-west-2 \
  --profile personal

# Set lifecycle policy
aws ecr put-lifecycle-policy \
  --repository-name webordinary/claude-code-astro \
  --lifecycle-policy-text '{
    "rules": [{
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
    }]
  }' \
  --region us-west-2 \
  --profile personal
```

### 2. AWS Secrets Manager Configuration

#### Secrets to Create
| Secret Name | Description | Example Value |
|-------------|-------------|---------------|
| `webordinary/anthropic-api-key` | Claude API key | `sk-ant-api03-...` |
| `webordinary/github-token` | GitHub personal access token | `ghp_...` |
| `webordinary/aws-credentials` | AWS credentials for S3 access | `{"accessKeyId":"...","secretAccessKey":"..."}` |

#### CDK Implementation
```typescript
// lib/secrets-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class SecretsStack extends cdk.Stack {
  public readonly anthropicApiKey: secretsmanager.Secret;
  public readonly githubToken: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Anthropic API Key
    this.anthropicApiKey = new secretsmanager.Secret(this, 'AnthropicApiKey', {
      secretName: 'webordinary/anthropic-api-key',
      description: 'Claude API key for Claude Code SDK',
      secretStringValue: cdk.SecretValue.unsafePlainText('REPLACE_WITH_ACTUAL_KEY'),
    });

    // GitHub Token
    this.githubToken = new secretsmanager.Secret(this, 'GitHubToken', {
      secretName: 'webordinary/github-token',
      description: 'GitHub personal access token for repository operations',
      secretStringValue: cdk.SecretValue.unsafePlainText('REPLACE_WITH_ACTUAL_TOKEN'),
    });

    // Output secret ARNs for cross-stack reference
    new cdk.CfnOutput(this, 'AnthropicApiKeyArn', {
      value: this.anthropicApiKey.secretArn,
      exportName: 'AnthropicApiKeyArn',
    });

    new cdk.CfnOutput(this, 'GitHubTokenArn', {
      value: this.githubToken.secretArn,
      exportName: 'GitHubTokenArn',
    });
  }
}
```

#### Manual Creation via CLI
```bash
# Create Anthropic API key secret
aws secretsmanager create-secret \
  --name webordinary/anthropic-api-key \
  --description "Claude API key for Claude Code SDK" \
  --secret-string "sk-ant-api03-YOUR-KEY-HERE" \
  --region us-west-2 \
  --profile personal

# Create GitHub token secret
aws secretsmanager create-secret \
  --name webordinary/github-token \
  --description "GitHub personal access token" \
  --secret-string "ghp_YOUR-TOKEN-HERE" \
  --region us-west-2 \
  --profile personal
```

### 3. EFS Filesystem for Persistent Workspaces

#### CDK Implementation
```typescript
// lib/efs-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

export class EFSStack extends cdk.Stack {
  public readonly fileSystem: efs.FileSystem;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Use default VPC
    const vpc = ec2.Vpc.fromLookup(this, 'VPC', {
      isDefault: true,
    });

    // Create EFS filesystem
    this.fileSystem = new efs.FileSystem(this, 'WorkspaceEFS', {
      vpc,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS, // Move to IA after 30 days
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Keep data on stack deletion
      encrypted: true,
      fileSystemName: 'webordinary-workspaces',
    });

    // Create access points for organization
    const clientAccessPoint = new efs.AccessPoint(this, 'ClientAccessPoint', {
      fileSystem: this.fileSystem,
      path: '/clients',
      createAcl: {
        ownerGid: '1000',
        ownerUid: '1000',
        permissions: '755',
      },
      posixUser: {
        gid: '1000',
        uid: '1000',
      },
    });

    // Cleanup Lambda function
    const cleanupFunction = new lambda.Function(this, 'CleanupThreads', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import os
import boto3
import json
from datetime import datetime, timedelta

def handler(event, context):
    efs_client = boto3.client('efs')
    
    # Logic to clean up old threads
    # - Delete threads older than 30 days
    # - Compress inactive threads
    
    return {
        'statusCode': 200,
        'body': json.dumps('Cleanup completed')
    }
      `),
      timeout: cdk.Duration.minutes(5),
      environment: {
        FILE_SYSTEM_ID: this.fileSystem.fileSystemId,
      },
    });

    // Schedule cleanup daily
    const rule = new events.Rule(this, 'CleanupSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.days(1)),
    });
    rule.addTarget(new targets.LambdaFunction(cleanupFunction));

    // Output EFS ID for cross-stack reference
    new cdk.CfnOutput(this, 'FileSystemId', {
      value: this.fileSystem.fileSystemId,
      exportName: 'WorkspaceEFSId',
    });

    new cdk.CfnOutput(this, 'FileSystemArn', {
      value: this.fileSystem.fileSystemArn,
      exportName: 'WorkspaceEFSArn',
    });
  }
}
```

#### Directory Structure Plan
```
/efs-root/clients/
├── ameliastamps/
│   ├── scott/                 # User workspace (persistent)
│   │   ├── project/           # Single git repository
│   │   │   ├── .git/          # All thread branches here
│   │   │   ├── node_modules/  # Shared across all threads
│   │   │   ├── .astro/        # Shared build cache
│   │   │   └── [project files]
│   │   ├── .claude/           # Claude state
│   │   │   ├── threads/       # Thread contexts
│   │   │   │   ├── thread-abc123.json
│   │   │   │   └── thread-xyz789.json
│   │   │   └── user.json     # User preferences
│   │   └── metadata.json     # Workspace metadata
│   ├── jane/                  # Another user
│   └── _archive/              # Old user data (compressed)
├── client2/
│   └── [users]/
└── client3/
    └── [users]/
```

### 4. ALB Setup (Foundation)

Since the Fargate task will need an ALB, we should create the base ALB infrastructure:

```typescript
// lib/alb-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';

export class ALBStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly listener: elbv2.ApplicationListener;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Use default VPC or create new one
    const vpc = ec2.Vpc.fromLookup(this, 'VPC', {
      isDefault: true,
    });

    // Create ALB
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'WebordinaryALB', {
      vpc,
      internetFacing: true,
      loadBalancerName: 'webordinary-edit-alb',
    });

    // Look up existing certificate (assuming it exists)
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'Certificate',
      'arn:aws:acm:us-west-2:942734823970:certificate/YOUR-CERT-ID'
    );

    // Create HTTPS listener
    this.listener = this.alb.addListener('HttpsListener', {
      port: 443,
      certificates: [certificate],
      defaultAction: elbv2.ListenerAction.fixedResponse(200, {
        contentType: 'text/plain',
        messageBody: 'Webordinary ALB - No target configured',
      }),
    });

    // HTTP redirect to HTTPS
    this.alb.addListener('HttpListener', {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    });

    // Output ALB ARN and DNS
    new cdk.CfnOutput(this, 'ALBArn', {
      value: this.alb.loadBalancerArn,
      exportName: 'WebordinaryALBArn',
    });

    new cdk.CfnOutput(this, 'ALBDnsName', {
      value: this.alb.loadBalancerDnsName,
      exportName: 'WebordinaryALBDnsName',
    });
  }
}
```

### 5. Deployment Script

```bash
#!/bin/bash
# deploy-prerequisites.sh

set -e

echo "🚀 Deploying prerequisite resources..."

# Deploy ECR repository
echo "📦 Creating ECR repository..."
npx cdk deploy ECRStack --profile personal --require-approval never

# Deploy Secrets (manual step required)
echo "🔐 Creating secrets..."
echo "Please update the secret values in secrets-stack.ts before deploying"
read -p "Have you updated the secret values? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]
then
    npx cdk deploy SecretsStack --profile personal --require-approval never
else
    echo "Please update secrets and run: npx cdk deploy SecretsStack --profile personal"
fi

# Deploy EFS filesystem
echo "💾 Creating EFS filesystem for workspaces..."
npx cdk deploy EFSStack --profile personal --require-approval never

# Deploy ALB
echo "⚖️ Creating Application Load Balancer..."
npx cdk deploy ALBStack --profile personal --require-approval never

echo "✅ Prerequisites deployed successfully!"
echo ""
echo "Next steps:"
echo "1. Update secret values in AWS Secrets Manager if needed"
echo "2. Note the ECR repository URI for Docker push"
echo "3. Note the EFS filesystem ID for Fargate mounting"
echo "4. Proceed with Task 01 (Docker container build)"
```

## Acceptance Criteria

1. ✅ ECR repository created with lifecycle policy
2. ✅ Secrets created in AWS Secrets Manager
3. ✅ EFS filesystem created with lifecycle policies
4. ✅ ALB deployed with HTTPS listener
5. ✅ All resources tagged appropriately
6. ✅ CloudFormation outputs exported for cross-stack reference
7. ✅ No hardcoded secrets in code
8. ✅ Resources retain on stack deletion (no data loss)
9. ✅ EFS cleanup Lambda scheduled

## Security Considerations

1. **Secret Rotation**: Plan for API key rotation
2. **IAM Permissions**: Least privilege for secret access
3. **Encryption**: Secrets encrypted at rest
4. **Audit Trail**: CloudTrail logging for secret access
5. **GitHub Token Scope**: Minimal permissions (repo read/write only)

## Cost Implications

| Resource | Monthly Cost | Notes |
|----------|-------------|-------|
| ECR Repository | $0.10/GB | ~$1 for 10 images |
| Secrets Manager | $0.40/secret | $1.20 for 3 secrets |
| EFS Standard | $0.30/GB | ~$3 for 10GB active |
| EFS IA | $0.025/GB | ~$2.25 for 90GB archived |
| ALB | $18-20 | Base cost, shared resource |
| Lambda (cleanup) | ~$0.10 | Daily execution |
| **Total** | **~$25-30** | One-time setup + storage |

## Dependencies

- AWS Account with appropriate permissions
- AWS CLI configured with `personal` profile
- Valid Anthropic API key
- GitHub personal access token with repo permissions
- Existing ACM certificate for `*.ameliastamps.com`

## Testing Checklist

1. [ ] ECR repository accessible
2. [ ] Can push/pull Docker images
3. [ ] Secrets readable by appropriate IAM roles
4. [ ] ALB responds on HTTPS
5. [ ] CloudFormation exports available
6. [ ] No sensitive data in CloudFormation outputs

## Rollback Plan

If deployment fails:
1. Check CloudFormation events for errors
2. Manually delete failed stacks
3. Verify IAM permissions
4. Re-run deployment script

## Estimated Effort

- CDK development: 2 hours
- Deployment and testing: 1 hour
- Documentation: 30 minutes
- **Total: 0.5 days**