# Task 08: Configure Route53 for amelia.webordinary.com

## Overview
Configure Route53 DNS to serve the astro-amelia site through existing infrastructure:
1. **Production**: amelia.webordinary.com → Existing CloudFront → S3 bucket
2. **Editor**: edit.amelia.webordinary.com → Existing ALB → Fargate containers

## Current State (From Sprint 1)
### Already Deployed Infrastructure
- ✅ **CloudFront Distribution** (E3FW6R4G95TKO2) 
  - Domain: dvbgbu22277vf.cloudfront.net
  - Origin: S3 bucket (amelia.webordinary.com)
  - GitHub Actions deploys to this S3 bucket
  - Currently using default CloudFront certificate
- ✅ **ALB with SSL** (webordinary-edit-alb-916355172.us-west-2.elb.amazonaws.com)
  - ACM Certificate: *.webordinary.com (ISSUED in us-west-2)
  - Covers webordinary.com and *.webordinary.com
  - HTTPS listener configured
- ✅ **Fargate Infrastructure**
  - Claude Code container in ECR
  - Auto-scaling service (0-3 tasks)
  - EFS persistent storage
- ✅ **Lambda Build Function** (HephaestusBuildFunction)
  - Processes GitHub webhooks
  - Builds astro-amelia and deploys to S3
  - Invalidates CloudFront cache

### What Needs Configuration
- ⚠️ CloudFront: Add amelia.webordinary.com as alternate domain name
- ⚠️ CloudFront: Need ACM certificate in us-east-1 region
- ⚠️ Route53: A record for amelia.webordinary.com → CloudFront
- ⚠️ Route53: A record for edit.amelia.webordinary.com → ALB

## Implementation Tasks

### Phase 1: ACM Certificate for CloudFront
Since CloudFront requires certificates in us-east-1:

```bash
# Request certificate in us-east-1
aws acm request-certificate \
  --domain-name "*.webordinary.com" \
  --validation-method DNS \
  --region us-east-1 \
  --profile personal
```

### Phase 2: Update CloudFront Distribution
1. **Add Alternate Domain Name**
   - Add: amelia.webordinary.com
   
2. **Attach ACM Certificate**
   - Use the certificate from us-east-1 (once validated)

### Phase 3: Configure Route53 Records

```bash
# Production site
1. A Record (ALIAS):
   - Name: amelia.webordinary.com
   - Type: A (IPv4)
   - Alias: Yes
   - Target: CloudFront distribution (dvbgbu22277vf.cloudfront.net)

# Editor environment  
2. A Record (ALIAS):
   - Name: edit.amelia.webordinary.com
   - Type: A (IPv4)
   - Alias: Yes
   - Target: ALB (webordinary-edit-alb-916355172.us-west-2.elb.amazonaws.com)
```

### Phase 4: Test & Validate
```bash
# After DNS propagation (5-60 minutes)

# Test production site
curl -I https://amelia.webordinary.com
# Expected: 200 OK, serving astro site

# Test editor (after scaling up Fargate)
aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --desired-count 1 \
  --profile personal

curl https://edit.amelia.webordinary.com/api/health
# Expected: {"status":"healthy",...}
```

## Success Criteria
- [ ] amelia.webordinary.com serves production Astro site via CloudFront
- [ ] edit.amelia.webordinary.com reaches Fargate editor environment
- [ ] SSL/HTTPS working on both domains
- [ ] GitHub Actions deployments continue working
- [ ] CloudFront invalidation after deployments

## Manual Configuration Steps

### 1. Request ACM Certificate in us-east-1
```bash
# Request wildcard certificate for CloudFront
aws acm request-certificate \
  --domain-name "*.webordinary.com" \
  --validation-method DNS \
  --region us-east-1 \
  --profile personal

# Save the CertificateArn from output
```

### 2. Validate Certificate via DNS
```bash
# Get validation records
aws acm describe-certificate \
  --certificate-arn <CERT_ARN> \
  --region us-east-1 \
  --profile personal \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'

# Add CNAME record to Route53 for validation
```

### 3. Update CloudFront via Console
1. Go to CloudFront Console
2. Select Distribution E3FW6R4G95TKO2
3. Edit General Settings
4. Alternate domain names: Add `amelia.webordinary.com`
5. Custom SSL Certificate: Select the ACM cert from us-east-1
6. Save changes

### 4. Create Route53 Records via Console
1. Go to Route53 → Hosted zones → webordinary.com
2. Create A record for amelia:
   - Name: amelia
   - Type: A
   - Alias: Yes
   - Route traffic to: CloudFront distribution
   - Select distribution: dvbgbu22277vf.cloudfront.net
3. Create A record for edit.amelia:
   - Name: edit.amelia
   - Type: A
   - Alias: Yes
   - Route traffic to: Application Load Balancer
   - Region: us-west-2
   - Select ALB: webordinary-edit-alb

## CDK Implementation (Alternative)
```typescript
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';

export class Route53Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Lookup hosted zone
    const hostedZone = route53.HostedZone.fromLookup(this, 'Zone', {
      domainName: 'webordinary.com'
    });

    // Import existing CloudFront
    const distribution = cloudfront.Distribution.fromDistributionAttributes(
      this, 'ExistingCF', {
        distributionId: 'E3FW6R4G95TKO2',
        domainName: 'dvbgbu22277vf.cloudfront.net'
      }
    );

    // Create DNS record for amelia.webordinary.com
    new route53.ARecord(this, 'AmeliaRecord', {
      zone: hostedZone,
      recordName: 'amelia',
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution)
      )
    });

    // Import existing ALB
    const alb = elbv2.ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(
      this, 'ExistingALB', {
        loadBalancerArn: 'arn:aws:elasticloadbalancing:us-west-2:942734823970:loadbalancer/app/webordinary-edit-alb/...',
        securityGroupId: 'sg-...' // from ALB
      }
    );

    // Create DNS record for edit.amelia.webordinary.com
    new route53.ARecord(this, 'EditAmeliaRecord', {
      zone: hostedZone,
      recordName: 'edit.amelia',
      target: route53.RecordTarget.fromAlias(
        new route53Targets.ApplicationLoadBalancerTarget(alb)
      )
    });
  }
}
```

## Rollback Plan
If issues occur:
1. Delete Route53 A records
2. Remove alternate domain from CloudFront
3. GitHub Actions continues to deploy to S3 (unaffected)

## Cost Impact
- ACM Certificate: Free
- Route53 hosted zone: Already exists (~$0.50/month)
- DNS queries: ~$0.40 per million queries
- No additional CloudFront or S3 costs
- **Total additional cost**: < $0.01/month

## Timeline
- ACM certificate request & validation: 5-30 minutes
- CloudFront update: 5 minutes (propagation 15-30 min)
- Route53 configuration: 10 minutes
- Testing: 10 minutes
- **Total**: ~30-60 minutes including propagation

## Notes
- The existing *.webordinary.com cert in us-west-2 covers the ALB/editor
- Need separate cert in us-east-1 for CloudFront
- Both amelia.webordinary.com and edit.amelia.webordinary.com are covered by *.webordinary.com
- Future: Consider adding www.amelia.webordinary.com redirect if needed
- Future: Add staging.amelia.webordinary.com for preview deployments