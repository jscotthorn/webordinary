# Step Functions Refactor Status

## Completed
- [x] Documentation updates (Sprint 0)
  - [x] Updated `/CLAUDE.md` with refactor notice
  - [x] Updated `/README.md` with refactor banner
  - [x] Updated `/hermes/CLAUDE.md` with deprecation notice
  - [x] Updated `/claude-code-container/CLAUDE.md` with refactor updates
  - [x] Updated `/hephaestus/CLAUDE.md` with infrastructure changes
  - [x] Created `/docs/REFACTOR_STATUS.md` tracking document

## In Progress
- [ ] Sprint 1: Infrastructure teardown

## Upcoming
- [ ] Sprint 2: Lambda functions
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