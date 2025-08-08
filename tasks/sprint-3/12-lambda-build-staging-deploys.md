# Task 11: Connect Existing Lambda Build to Staging Deploys

## Overview
Integrate the existing Lambda-based build system from the original Hephaestus stack with the new Fargate-based editing environment to enable automatic staging deployments when changes are made through Claude Code.

## Background
- Original Hephaestus has Lambda functions for S3 deployment
- Current system uses Fargate for live editing
- Need to bridge editing environment with deployment pipeline
- Existing Lambda can be reused with modifications

## Requirements

### Core Integration
1. **Trigger Staging Builds**
   - On PR creation (from Task 10)
   - On manual request via email
   - On session completion
   - Preview builds for testing

2. **Lambda Function Updates**
   - Accept build requests from Fargate
   - Pull from feature branches
   - Deploy to staging S3 bucket
   - Return preview URLs

3. **Build Pipeline Flow**
   - Git push → PR created → Lambda triggered
   - Build Astro site → Deploy to S3
   - Invalidate CloudFront → Return URL
   - Update session with deployment info

4. **Multiple Environment Support**
   - Development (Fargate live preview)
   - Staging (S3 + CloudFront)
   - Production (S3 + CloudFront)
   - Per-branch preview deploys

## Technical Implementation

### 1. Lambda Build Function Updates
```typescript
// Update existing Lambda handler
export const handler = async (event: BuildEvent): Promise<BuildResult> => {
  const { 
    repository,
    branch,
    environment,
    sessionId,
    triggeredBy,
  } = event;
  
  try {
    // Clone repository at specific branch
    await git.clone({
      url: `https://github.com/${repository}.git`,
      branch,
      dir: '/tmp/build',
      auth: process.env.GITHUB_TOKEN,
    });
    
    // Install dependencies
    await exec('npm ci', { cwd: '/tmp/build' });
    
    // Build Astro site
    await exec('npm run build', { 
      cwd: '/tmp/build',
      env: {
        ...process.env,
        PUBLIC_ENV: environment,
      },
    });
    
    // Deploy to appropriate S3 bucket
    const bucketName = this.getBucketName(environment, branch);
    const deploymentUrl = await this.deployToS3(
      '/tmp/build/dist',
      bucketName,
    );
    
    // Invalidate CloudFront if needed
    if (environment !== 'development') {
      await this.invalidateCloudFront(deploymentUrl);
    }
    
    // Store deployment info
    await this.storeDeploymentInfo({
      sessionId,
      environment,
      url: deploymentUrl,
      branch,
      timestamp: new Date(),
      status: 'success',
    });
    
    return {
      success: true,
      url: deploymentUrl,
      environment,
      branch,
    };
  } catch (error) {
    await this.storeDeploymentInfo({
      sessionId,
      environment,
      branch,
      timestamp: new Date(),
      status: 'failed',
      error: error.message,
    });
    
    throw error;
  }
};

private getBucketName(environment: string, branch: string): string {
  switch (environment) {
    case 'production':
      return 'ameliastamps-production';
    case 'staging':
      return 'ameliastamps-staging';
    case 'preview':
      return `ameliastamps-preview-${branch.replace(/[^a-z0-9]/g, '-')}`;
    default:
      throw new Error(`Unknown environment: ${environment}`);
  }
}
```

### 2. Build Trigger Service
```typescript
// New service in Hermes to trigger Lambda builds
@Injectable()
export class BuildTriggerService {
  private lambda: LambdaClient;
  
  constructor(private config: ConfigService) {
    this.lambda = new LambdaClient({
      region: config.get('AWS_REGION'),
    });
  }
  
  async triggerStagingBuild(params: BuildParams): Promise<BuildResult> {
    const command = new InvokeCommand({
      FunctionName: 'webordinary-build-function',
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({
        repository: params.repository,
        branch: params.branch,
        environment: 'staging',
        sessionId: params.sessionId,
        triggeredBy: params.triggeredBy,
      }),
    });
    
    const response = await this.lambda.send(command);
    const result = JSON.parse(
      new TextDecoder().decode(response.Payload),
    );
    
    if (!result.success) {
      throw new Error(`Build failed: ${result.error}`);
    }
    
    return result;
  }
  
  async triggerProductionBuild(
    params: BuildParams,
  ): Promise<BuildResult> {
    // Require approval before production builds
    if (!params.approved) {
      throw new Error('Production builds require approval');
    }
    
    return this.triggerBuild({
      ...params,
      environment: 'production',
    });
  }
  
  async getDeploymentStatus(
    sessionId: string,
  ): Promise<DeploymentStatus> {
    // Query DynamoDB for deployment info
    const result = await this.dynamodb.query({
      TableName: 'webordinary-deployments',
      KeyConditionExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: {
        ':sessionId': sessionId,
      },
      ScanIndexForward: false,
      Limit: 1,
    });
    
    return result.Items[0] as DeploymentStatus;
  }
}
```

### 3. GitHub Webhook Handler
```typescript
// Handle GitHub PR events to trigger builds
@Controller('webhooks/github')
export class GitHubWebhookController {
  @Post()
  async handleWebhook(
    @Headers('x-github-event') event: string,
    @Headers('x-hub-signature-256') signature: string,
    @Body() payload: any,
  ) {
    // Verify webhook signature
    if (!this.verifySignature(signature, payload)) {
      throw new UnauthorizedException('Invalid signature');
    }
    
    switch (event) {
      case 'pull_request':
        await this.handlePullRequest(payload);
        break;
      case 'push':
        await this.handlePush(payload);
        break;
    }
  }
  
  private async handlePullRequest(payload: any) {
    if (payload.action === 'opened' || payload.action === 'synchronize') {
      // Trigger staging build for new/updated PRs
      await this.buildService.triggerStagingBuild({
        repository: payload.repository.full_name,
        branch: payload.pull_request.head.ref,
        sessionId: this.extractSessionId(payload.pull_request.head.ref),
        triggeredBy: 'github_pr',
      });
      
      // Post comment with preview URL
      await this.github.createComment(
        payload.pull_request.number,
        '🚀 Staging deployment triggered. Preview will be available shortly.',
      );
    }
  }
  
  private extractSessionId(branch: string): string {
    // Extract session ID from branch name (thread-{sessionId}-{timestamp})
    const match = branch.match(/thread-([a-z0-9]+)-/);
    return match ? match[1] : 'unknown';
  }
}
```

### 4. CDK Stack Updates
```typescript
// Add deployment infrastructure to CDK
export class DeploymentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    
    // S3 buckets for different environments
    const stagingBucket = new s3.Bucket(this, 'StagingBucket', {
      bucketName: 'ameliastamps-staging',
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: '404.html',
      publicReadAccess: true,
      cors: [{
        allowedOrigins: ['*'],
        allowedMethods: [s3.HttpMethods.GET],
      }],
    });
    
    const productionBucket = new s3.Bucket(this, 'ProductionBucket', {
      bucketName: 'ameliastamps-production',
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: '404.html',
      publicReadAccess: true,
    });
    
    // CloudFront distributions
    const stagingDistribution = new cloudfront.Distribution(
      this,
      'StagingDistribution',
      {
        defaultBehavior: {
          origin: new origins.S3Origin(stagingBucket),
          viewerProtocolPolicy: 
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
        domainNames: ['staging.ameliastamps.com'],
        certificate: props.certificate,
      },
    );
    
    // DynamoDB table for deployment tracking
    const deploymentTable = new dynamodb.Table(
      this,
      'DeploymentTable',
      {
        tableName: 'webordinary-deployments',
        partitionKey: {
          name: 'sessionId',
          type: dynamodb.AttributeType.STRING,
        },
        sortKey: {
          name: 'timestamp',
          type: dynamodb.AttributeType.NUMBER,
        },
        timeToLiveAttribute: 'ttl',
      },
    );
    
    // Grant Lambda permissions
    deploymentTable.grantReadWriteData(props.buildLambda);
    stagingBucket.grantReadWrite(props.buildLambda);
    productionBucket.grantReadWrite(props.buildLambda);
  }
}
```

### 5. Email Integration
```typescript
// Handle build commands via email
class EmailCommandProcessor {
  async processCommand(command: string, context: EmailContext) {
    const commands = {
      'deploy staging': this.deployStagingCommand,
      'deploy production': this.deployProductionCommand,
      'show preview': this.showPreviewCommand,
    };
    
    const handler = commands[command.toLowerCase()];
    if (handler) {
      return handler.call(this, context);
    }
  }
  
  private async deployStagingCommand(context: EmailContext) {
    const result = await this.buildService.triggerStagingBuild({
      repository: context.repository,
      branch: context.branch,
      sessionId: context.sessionId,
      triggeredBy: 'email_command',
    });
    
    return `Staging deployment started. Preview will be available at: ${result.url}`;
  }
}
```

## Implementation Steps

### Phase 1: Lambda Function Updates
1. Modify existing build Lambda for branch support
2. Add environment-based bucket selection
3. Implement deployment tracking
4. Test with manual invocation

### Phase 2: Integration Services
1. Create BuildTriggerService in Hermes
2. Add webhook handlers for GitHub
3. Implement deployment status tracking
4. Connect to email processor

### Phase 3: Infrastructure Setup
1. Create staging/production S3 buckets
2. Configure CloudFront distributions
3. Set up deployment tracking table
4. Update IAM permissions

### Phase 4: Testing & Validation
1. Test PR-triggered builds
2. Verify staging deployments
3. Test production approval flow
4. Validate rollback mechanism

## Deployment Flow

### Staging Deployment
```
Code Change → Git Push → PR Created → Webhook → Lambda Build → S3 Deploy → CloudFront → Preview URL
```

### Production Deployment
```
PR Approved → Merge to Main → Lambda Build → S3 Deploy → CloudFront Invalidation → Live Site
```

## Success Criteria

### Functional Requirements
- [ ] Lambda builds from feature branches
- [ ] Automatic staging deploys on PR
- [ ] Preview URLs generated
- [ ] Production requires approval
- [ ] Deployment status tracked

### Performance Requirements
- [ ] Builds complete in < 2 minutes
- [ ] CloudFront invalidation < 30 seconds
- [ ] Parallel builds supported
- [ ] Build caching implemented

### Integration Requirements
- [ ] Works with GitHub branches (Task 10)
- [ ] Connects to approval flow (Task 12)
- [ ] Updates session status
- [ ] Email notifications sent

## Testing Plan

### Lambda Testing
```bash
# Test build function locally
sam local invoke BuildFunction --event test-event.json

# Deploy and test in AWS
aws lambda invoke --function-name webordinary-build-function \
  --payload '{"branch": "test-branch", "environment": "staging"}' \
  response.json
```

### Integration Testing
```bash
# Trigger build via API
curl -X POST $API_URL/api/build/trigger \
  -d '{"sessionId": "test-123", "environment": "staging"}'

# Check deployment status
curl $API_URL/api/build/status/test-123

# Verify S3 deployment
aws s3 ls s3://ameliastamps-staging/
```

## Cost Optimization

### Lambda Optimization
- Use ARM-based Lambda for cost savings
- Implement build caching in EFS
- Reuse npm cache across builds
- Parallelize build steps

### S3 Optimization
- Use S3 Intelligent-Tiering
- Implement lifecycle policies
- Clean up old preview deployments
- Compress assets before upload

## Monitoring

### CloudWatch Metrics
- Build duration
- Build success rate
- Deployment frequency
- Error rates

### Alarms
- Build failures
- Long build times (> 5 minutes)
- CloudFront errors
- S3 bucket size warnings

## Dependencies
- Existing Lambda build function
- GitHub webhook access
- S3 buckets configured
- CloudFront distributions ready
- IAM roles with proper permissions

## Estimated Timeline
- Lambda Updates: 3 hours
- Integration Services: 4 hours
- Infrastructure Setup: 2 hours
- Testing: 2 hours
- **Total: 1.5 days**

## Future Enhancements
- Blue-green deployments
- Automatic rollback on errors
- Build artifact caching
- Parallel multi-site builds
- Container-based builds for consistency

## Notes
- Consider using CodeBuild for complex builds
- Implement build queuing for multiple requests
- Add support for environment variables
- Plan for build failure notifications