# WebOrdinary Architecture Refactor Plan

## Current State Analysis

The WebOrdinary project has evolved through multiple architectural iterations, leaving a mix of legacy patterns and new implementations. This document serves as the authoritative guide for cleaning up and standardizing the codebase to align with the current Sprint 7+ architecture.

## Key Terminology Clarifications

### Entity Hierarchy
- **Client**: Account holder (future concept, not currently implemented)
  - Can have multiple projects
  - Example: "Amelia Stamps Inc" (future)
- **Project**: Specific website/application
  - Current example: "amelia" (the Astro site)
  - Lives in a git repository
- **User**: Email address operating on projects
  - Example: escottster@gmail.com
  - Can work across multiple projects and clients
- **Session**: Communication thread (email thread, future: chat/SMS)
  - Maps to git branch: `thread-{chatThreadId}`
  - Persists across messages in same thread

### Current Implementation
- **Project+User**: Container ownership model
  - One container claims "amelia+escottster@gmail.com"
  - Not one container per session/thread
- **Unclaimed Queue**: Available work for warm containers
  - Contains project+user combinations without active claims

## Target Architecture (Current Implementation)

### Core Components

1. **Hermes (Message Orchestrator)**
   - **Role**: Email ingestion, message parsing, session management, queue routing
   - **Technology**: NestJS application running on ECS/Fargate
   - **Responsibilities**:
     - Receives emails from SES → SQS queue
     - Parses email structure and extracts session/user/project information
     - Manages project+user claim state in DynamoDB
     - Routes messages to appropriate project+user input queues
     - Places unclaimed work in unclaimed queue for warm containers

2. **Claude Code Container (Message Processor)**
   - **Role**: Process user instructions, manage git, build sites, deploy to S3
   - **Technology**: NestJS application with Claude Code CLI integration
   - **Responsibilities**:
     - Monitor unclaimed queue when warm and without active claim
     - Claim project+user combinations and switch to their EFS workspace
     - Clone/checkout git repositories (per session branch pattern)
     - Process user messages through Claude Code CLI
     - Build Astro projects after changes
     - Sync built sites to S3 buckets (edit.{client}.webordinary.com)
     - Commit and push changes to upstream git repositories
     - Handle interrupts and edge cases

3. **Hephaestus (Infrastructure)**
   - **Role**: CDK infrastructure-as-code for AWS resources
   - **Technology**: AWS CDK TypeScript
   - **Manages**:
     - ECS clusters and Fargate services
     - SQS queues (email, unclaimed, project+user specific)
     - DynamoDB tables (sessions, thread mappings, containers)
     - EFS for shared workspace storage
     - S3 buckets for static site hosting
     - ALB for health checks only (no web traffic routing)

### Message Flow

```
1. User → Email → buddy@webordinary.com
2. SES → SQS Email Queue
3. Hermes picks up email:
   - Parses structure
   - Finds/creates session ID
   - Determines project+user
   - Sends to project+user input queue
   - If no active claim, also sends to unclaimed queue
4. Claude Container (warm, no claim):
   - Monitors unclaimed queue
   - Claims project+user
   - Switches to project+user EFS directory
   - Clones repo if needed (from message)
   - Checks out session branch (thread-{chatThreadId})
5. Claude Container processes:
   - Passes instruction to Claude Code CLI
   - On changes: Build Astro → Sync to S3
   - Commits changes with context
   - Pushes to upstream repository
6. Result: Live site at edit.{client}.webordinary.com
```

## Legacy Patterns to Remove

### 1. HTTP/WebSocket Architecture (Sprint 1-5)
**Status**: Partially removed, cleanup needed

- **Old Pattern**: Containers served HTTP on port 8080, ALB routed web traffic
- **Current Pattern**: No web serving, S3 hosts all sites
- **Cleanup Needed**:
  - Remove remaining Express server code
  - Remove port 8080 references
  - Remove ALB web routing configuration
  - Update health checks to use CloudWatch logs only

### 2. Session-per-Container Pattern
**Status**: Deprecated, needs documentation updates

- **Old Pattern**: One container per session
- **Current Pattern**: One container per project+user
- **Cleanup Needed**:
  - Update documentation to reflect project+user claiming
  - Remove session-specific container launching code
  - Update test scenarios

### 3. Direct ALB → Container Web Traffic
**Status**: Removed but documentation persists

- **Old Pattern**: ALB routing /session/* to containers
- **Current Pattern**: All web traffic serves from S3
- **Cleanup Needed**:
  - Remove ALB routing rules for web traffic
  - Update integration tests
  - Clean up routing documentation

### 4. Local Development Confusion
**Status**: Recently introduced, needs cleanup

- **Problem**: Local dev attempt mixed test data with production queues
- **Evidence**: DLQ contains both real emails and test messages with "unknown" fields
- **Current State**: Docker Compose setup exists but message format confusion
- **Cleanup Needed**:
  - Separate local vs production message handling
  - Fix message format expectations in Hermes
  - Ensure local dev uses same message schema as production
  - Add proper test data generation for local development

### 5. Container Lifecycle Pattern (Critical)
**Status**: Architecture changed but code hasn't caught up

- **Old Pattern**: Containers pre-configured with REPO_URL env var for specific project+user
- **Current Pattern**: Generic containers that claim work dynamically
- **Evidence**: Code still checking `process.env.REPO_URL` in multiple places
- **Critical Files**:
  - claude-code-container/src/main.ts (line 25)
  - hephaestus/lib/fargate-stack.ts (hardcoded repo)
  - hermes container spawning code
- **Cleanup Needed**:
  - Remove all REPO_URL environment variables
  - Get repository URL from messages instead
  - Remove CLIENT_ID, DEFAULT_USER_ID, etc.
  - Update container initialization logic

### 6. Thread ID Extraction (Email Continuity)
**Status**: Broken - email clients don't preserve custom headers

- **Problem**: Thread IDs embedded in email headers are lost when users reply
- **Current Attempt**: Pattern matching `thread-xxx@` in headers that don't exist
- **Impact**: Sessions fragment, git branches multiply, user work gets lost
- **Solution Needed**:
  - Embed thread ID in email body/template
  - Extract from body when headers fail
  - Consider Message-ID format that clients preserve
- **Files to Fix**:
  - hermes/src/modules/email-processor/email-processor.service.ts
  - hermes/src/modules/message-processor/thread-extractor.service.ts

## Refactor Plan

### Phase 1: Documentation Audit and Authority Establishment
**Timeline**: 1-2 days

1. **Create Authority Documents**
   - [x] This README as central truth
   - [ ] Component-specific refactor guides
   - [ ] Migration checklist for each component

2. **Inventory Legacy References**
   - [ ] Scan all READMEs for outdated patterns
   - [ ] List all test files with legacy assumptions
   - [ ] Identify code with HTTP/WebSocket references

3. **Establish Naming Conventions**
   - `project+user` not `session` for container claims
   - `unclaimed` queue for available work
   - `edit.{client}.webordinary.com` for S3 buckets

### Phase 2: Code Cleanup
**Timeline**: 2-3 days

1. **Claude Code Container**
   - [ ] Remove Express server and port 8080
   - [ ] Clean up WebSocket code
   - [ ] Ensure clean message processing flow
   - [ ] Verify S3 sync is primary deployment

2. **Hermes**
   - [ ] Ensure project+user claim logic is clear
   - [ ] Remove any session-per-container assumptions
   - [ ] Verify unclaimed queue handling

3. **Hephaestus**
   - [ ] Remove ALB web routing rules
   - [ ] Update health check configurations
   - [ ] Clean up unused resources

### Phase 3: Test Suite Modernization
**Timeline**: 2-3 days

1. **Integration Tests**
   - [ ] Remove HTTP endpoint tests
   - [ ] Add S3 deployment verification
   - [ ] Update to test queue-based flow
   - [ ] Test project+user claiming

2. **Container Tests**
   - [ ] Remove web server tests
   - [ ] Focus on message processing
   - [ ] Test git operations
   - [ ] Verify S3 sync

3. **End-to-End Tests**
   - [ ] Email → S3 deployment flow
   - [ ] Multi-user scenarios
   - [ ] Interrupt handling

### Phase 4: Documentation Update
**Timeline**: 1-2 days

1. **Component READMEs**
   - [ ] Update claude-code-container/README.md
   - [ ] Update hermes/README.md
   - [ ] Update hephaestus/README.md
   - [ ] Update tests/integration/README.md

2. **Quick Reference Files (CLAUDE.md)**
   - [ ] Ensure all reflect current architecture
   - [ ] Remove legacy command examples
   - [ ] Add current deployment flows

3. **Remove Deprecated Docs**
   - [ ] Archive old architecture diagrams
   - [ ] Remove references to localhost:8080
   - [ ] Clean up WebSocket documentation

### Phase 5: Local Development Alignment
**Timeline**: 1 day

1. **Docker Compose**
   - [ ] Ensure matches production architecture
   - [ ] No port 8080 mappings
   - [ ] Proper queue configuration

2. **Scripts**
   - [ ] Update build scripts
   - [ ] Clean deployment scripts
   - [ ] Remove legacy utilities

## Success Criteria

1. **Clear Architecture**: No confusion between old and new patterns
2. **Consistent Documentation**: All docs reflect current implementation
3. **Passing Tests**: All tests work with current architecture
4. **Clean Codebase**: No dead code from previous iterations
5. **Developer Clarity**: New developers understand system immediately

## Component-Specific Issues to Address

### claude-code-container
- Remove `/api/*` endpoints
- Remove Express server
- Remove port 8080 configuration
- Focus on SQS → Process → S3 flow
- Clean up health check assumptions

### hermes
- Clarify project+user vs session ownership
- Document unclaimed queue pattern clearly
- Remove any HTTP routing logic
- Ensure DynamoDB schemas match current use

### hephaestus
- Remove ALB rules for web traffic
- Update CloudWatch dashboards
- Clean up unused IAM permissions
- Simplify network configuration

### tests
- Remove ALB routing tests
- Add S3 deployment verification
- Update queue message schemas
- Test claim/unclaim patterns

## Implementation Order

1. **Start with this authority document** (Complete)
2. **Audit existing documentation** (Next)
3. **Create migration checklists**
4. **Execute code cleanup**
5. **Update tests**
6. **Final documentation pass**

## Monitoring Progress

Track progress in subdirectories:
- `/refactor-authority/audits/` - Documentation inventory
- `/refactor-authority/checklists/` - Component migration lists
- `/refactor-authority/issues/` - Specific problems found
- `/refactor-authority/completed/` - Finished refactors

## Key Principles

1. **S3 is the only web serving mechanism** - No containers serve HTTP
2. **Queues drive all communication** - No direct HTTP between services
3. **One container per project+user** - Not per session
4. **Git branches per session** - thread-{chatThreadId} pattern
5. **EFS for persistence** - Shared workspace across container restarts
6. **CloudWatch for health** - No HTTP health endpoints needed

## Next Steps

1. Create audit documents for each component
2. Build detailed checklists for cleanup
3. Prioritize based on impact and risk
4. Execute systematically with testing at each step
5. Update all documentation as final step

---

**Status**: Planning Phase  
**Owner**: System Architect  
**Last Updated**: 2025-01-12