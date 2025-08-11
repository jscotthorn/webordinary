# Sprint 7: Git Workflow Enhancement & S3 Integration

## Sprint Goal
Enhance existing git branch management to properly handle multi-session workflows and integrate with S3 deployment pipeline.

## Sprint Overview
**Duration**: 1 week  
**Focus**: Complete git workflow with push, better commits, and S3 integration  
**Outcome**: Full edit → build → commit → push → S3 workflow

## Context
The container already has git branch management for sessions (thread-{chatThreadId} branches), but needs:
- Push commits to remote after changes
- Integration with S3 sync workflow
- Better commit messages from Claude operations
- Handling of edge cases and conflicts

## Current State
The `MessageProcessor` already:
- Switches branches for different sessions (`switchToSession`)
- Auto-commits when interrupted (`autoCommitChanges`)
- Creates branches for new sessions
- Handles session interrupts properly

The `GitService` already has:
- Branch operations (checkout, create)
- Commit operations (stage, commit, push)
- Status checking
- Repository initialization

## Task Breakdown

### Core Enhancements

1. **[Task 01: Add Push After Commits](01-add-push-after-commits.md)** (1-2 hours)
   - Update auto-commit to also push
   - Add push after Claude operations
   - Handle push failures gracefully

2. **[Task 02: Integrate Build and S3 Sync](02-integrate-build-s3.md)** (2-3 hours)
   - Add Astro build after Claude changes
   - Integrate S3 sync after successful builds
   - Proper sequencing: Claude → Commit → Build → S3 → Push

3. **[Task 03: Improve Commit Messages](03-improve-commit-messages.md)** (1-2 hours)
   - Extract meaningful messages from Claude operations
   - Use actual command/instruction as commit message
   - Add session/user context to commits

4. **[Task 04: Handle Git Conflicts](04-handle-git-conflicts.md)** (2-3 hours)
   - Handle merge conflicts when switching branches
   - Stash/restore for uncommitted changes
   - Recovery strategies for failed operations

5. **[Task 05: Test Multi-Session Workflow](05-test-multi-session.md)** (2-3 hours)
   - Test rapid session switching
   - Verify branch isolation
   - Confirm S3 deployments work per session
   - Test interrupt scenarios

## Success Criteria
- [ ] All commits are pushed to remote
- [ ] S3 sync happens after every build
- [ ] Commit messages are descriptive
- [ ] Branch switching handles conflicts gracefully
- [ ] Multi-session workflow fully tested
- [ ] Sites update at edit.amelia.webordinary.com after each operation

## Dependencies
- Sprint 6 completed (S3 setup and container refactoring)
- Git repository accessible from container
- AWS credentials for S3 sync
- GitHub token for push operations

## Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Push failures | Changes not saved | Queue pushes, retry logic |
| Merge conflicts | Session switching fails | Auto-stash uncommitted changes |
| S3 sync failures | Site not updated | Log errors, continue workflow |
| Build failures | No deployment | Commit code anyway, report error |

## Testing Scenarios
1. Single session with multiple commands
2. Rapid session switching (A→B→A)
3. Interrupt during build/deploy
4. Concurrent sessions from different users
5. Recovery from failed push/sync

## Notes
- Building on existing git infrastructure
- Not recreating what already works
- Focus on completing the workflow
- Keep changes minimal and focused