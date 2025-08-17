# Step Functions Refactor Status

## Completed
- [x] Documentation updates (Sprint 0) - 2025-08-17
  - [x] Updated `/CLAUDE.md` with refactor notice
  - [x] Updated `/README.md` with refactor banner
  - [x] Updated `/hermes/CLAUDE.md` with deprecation notice
  - [x] Updated `/claude-code-container/CLAUDE.md` with refactor updates
  - [x] Updated `/hephaestus/CLAUDE.md` with infrastructure changes
  - [x] Created `/docs/REFACTOR_STATUS.md` tracking document

- [x] Sprint 1 Day 1: Infrastructure teardown - 2025-08-17
  - [x] Scaled Hermes service to 0 in ECS
  - [x] Deleted HermesStack from CloudFormation
  - [x] Deleted webordinary-email-queue
  - [x] Deleted all Hermes container images and ECR repository
  - [x] Documented final Hermes configuration

- [x] Sprint 1 Day 2-3: Manual resource creation - 2025-08-17
  - [x] Created media-source.amelia.webordinary.com bucket
  - [x] Configured bucket encryption, versioning, and lifecycle
  - [x] Created webordinary-interrupts-amelia-scott queue
  - [x] Updated queue visibility timeouts
  - [x] Deferred CDK resources (SES bucket, active-jobs table)

- [x] Sprint 2 Day 4-5: Core Lambda functions with Local Dev Stack - 2025-08-17
  - [x] Created intake-lambda for S3 trigger → parse → Step Functions
  - [x] Created process-attachment-lambda with Sharp for image optimization  
  - [x] **DETOUR**: Complete local development environment overhaul
    - [x] Created unified scripts (start-local.sh, stop-local.sh, test-email.sh)
    - [x] Integrated LocalStack for all AWS services
    - [x] Removed Hermes dependencies from local development
    - [x] Consolidated 10+ scripts into 3
  - [x] Created Step Functions ASL definition (pulled from Sprint 3)
  - [x] Created CDK StepFunctionsStack (pulled from Sprint 3)
  - [x] Successfully tested both Lambda functions
  - [x] Validated complete email processing flow

## In Progress
- [ ] Sprint 2 Day 6-7: Support Lambda functions
  - [ ] check-active-job-lambda: DynamoDB check + interrupt send
  - [ ] rate-limited-claim-lambda: Conditional DynamoDB writes
  - [ ] record-interruption-lambda: Audit trail
  - [ ] handle-timeout-lambda: Timeout handling
  - [ ] Unit tests with mocked AWS services

## Upcoming
- [ ] Sprint 3: Step Functions deployment
- [ ] Sprint 4: Container integration
- [ ] Sprint 5: Testing
- [ ] Sprint 6: Cleanup

## Architecture Summary
**Current**: Email → SES → SQS → Hermes → Container → S3 → User  
**Target**: Email → SES → S3 → Lambda → Step Functions → Container → S3 → User

## Key Benefits
- Eliminates Hermes service entirely
- Reduces complexity and operational overhead
- Provides complete execution visibility via Step Functions
- Enables true preemption with interrupt queues
- Improves attachment handling with optimized web formats

## Timeline
- Sprint 0: ✅ Complete (2025-08-17)
- Sprint 1: 2-3 days (Infrastructure teardown)
- Sprint 2: 3-4 days (Lambda functions)
- Sprint 3: 3-4 days (Step Functions)
- Sprint 4: 4-5 days (Container integration)
- Sprint 5: 3-4 days (Testing)
- Sprint 6: 2 days (Cleanup)
- **Total**: ~23 working days (4-5 weeks)

## Notes
- Single developer environment (Scott)
- PoC Client: Amelia project only
- Zero external traffic - can be destructive with changes
- All Hermes code scheduled for deletion - DO NOT MODIFY