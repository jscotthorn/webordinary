# Sprint 6: S3 Static Hosting Foundation

## Sprint Goal
Transition from container web serving to S3 static hosting with simplified container architecture.

## Sprint Overview
**Duration**: 1-2 weeks  
**Focus**: S3 static hosting setup and container refactoring  
**Outcome**: Complete email → S3 workflow without web serving containers

## Context
We're transitioning from container-based web serving to S3 static hosting to:
- Eliminate ALB/Lambda routing complexity
- Remove container port management
- Reduce infrastructure costs (~$20-25/month)
- Simplify deployment (build → S3 sync)
- Enable instant updates without CloudFront invalidation

## Task Breakdown

### Phase 1: S3 Setup (Few hours)
1. **[Task 01: Create S3 Bucket](01-create-s3-bucket.md)** (5-10 minutes)
   - Create `edit.amelia.webordinary.com` bucket
   - Configure static website hosting
   - Set up public access and bucket policy

2. **[Task 02: Configure Route53](02-configure-route53.md)** (5-10 minutes)
   - Create A record alias to S3
   - Verify DNS propagation
   - Test domain resolution

3. **[Task 03: Test Local S3 Sync](03-test-local-s3-sync.md)** (20-45 minutes)
   - Build Astro project locally
   - Test S3 sync commands
   - Verify immediate updates

### Phase 2: Container Refactoring (Main work)
4. **[Task 04: Remove Web Server](04-remove-web-server.md)** (1-2 hours)
   - Remove Express/WebServerService
   - Remove port 8080 and health checks
   - Simplify container to message processing only

5. **[Task 05: Add S3 Sync](05-add-s3-sync.md)** (2-3 hours)
   - Add AWS CLI to container
   - Implement S3 sync after builds
   - IAM permissions via CDK (Task 08)

6. **[Task 06: Test Container Locally](06-test-container-locally.md)** (2-3 hours)
   - Run modified container with Docker
   - Test SQS → Build → S3 workflow
   - Debug and verify functionality

7. **[Task 08: Update CDK Permissions](08-update-cdk-permissions.md)** (1-2 hours)
   - Add S3 permissions to task role via CDK
   - Remove port mappings and health checks
   - Deploy infrastructure changes properly
   - **Must be done before Task 07**

8. **[Task 07: Deploy to ECS](07-deploy-to-ecs.md)** (1-2 hours)
   - Push container to ECR
   - Deploy with CDK-updated permissions
   - Test email → S3 workflow end-to-end

## Success Criteria
- [ ] S3 bucket serving static content at edit.amelia.webordinary.com
- [ ] DNS properly configured and resolving
- [ ] Local S3 sync workflow validated, edit domain populated live
- [ ] Container refactored without web server
- [ ] S3 sync working from container
- [ ] Email → Container → S3 → Live site workflow complete

## Dependencies
- AWS account access with S3 and Route53 permissions
- Access to Astro project repository
- AWS CLI configured locally
- Node.js environment for builds

## Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| DNS propagation delays | Delays testing | Use S3 endpoint URL directly for testing |
| CORS configuration issues | Assets won't load | Test configuration thoroughly, document working setup |
| S3 sync performance | Slow deployments | Test optimization flags, consider partial syncs |
| Build failures | Blocked deployment | Document error handling, test failure scenarios |

## Next Sprint Preview (Sprint 7)
**Container Refactoring** - Remove web server, add S3 sync capability:
- Remove Express/WebServerService
- Remove port 8080 and health checks
- Add Claude CLI integration
- Add S3 sync with IAM permissions
- Local container testing

## Notes
- This is manual setup for PoC - will automate with CDK in future
- No CloudFront for dev environment (avoid invalidation delays)
- HTTP only initially (HTTPS requires CloudFront)
- Keep production bucket (amelia.webordinary.com) unchanged

## Team Coordination
- **DevOps**: AWS access and permissions setup
- **Frontend**: Astro build optimization
- **Backend**: Container refactoring planning
- **QA**: Test scenario development

## Daily Standup Topics
- Day 1: S3 bucket creation status
- Day 2: DNS configuration and testing
- Day 3: Local sync workflow validation  
- Day 4: Documentation progress
- Day 5: Performance testing results

## Definition of Done
- [ ] All 5 tasks completed
- [ ] edit.amelia.webordinary.com serving from S3
- [ ] Documentation reviewed and approved
- [ ] Performance metrics collected
- [ ] Sprint retrospective conducted
- [ ] Sprint 7 tasks refined and ready