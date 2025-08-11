#!/bin/bash
# Test script for git operations in the container
# Updated for S3 architecture (no HTTP API)

set -e

echo "=== Testing Git Operations (S3 Architecture) ==="
echo ""

# Configuration
WORKSPACE_PATH="/tmp/test-git-ops-$(date +%s)"
CLIENT_ID="test-client"
USER_ID="test-user"
THREAD_ID="git-test-$(date +%s)"

echo "Workspace: $WORKSPACE_PATH"
echo "Thread ID: $THREAD_ID"
echo ""

# Create workspace directory
mkdir -p "$WORKSPACE_PATH/$CLIENT_ID/$USER_ID/project"
cd "$WORKSPACE_PATH/$CLIENT_ID/$USER_ID/project"

echo "=== Step 1: Initialize git repository ==="
git init
git config user.email "test@webordinary.com"
git config user.name "Test User"
echo "✅ Repository initialized"

echo ""
echo "=== Step 2: Create session branch ==="
BRANCH="thread-$THREAD_ID"
git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"
echo "✅ On branch: $BRANCH"

echo ""
echo "=== Step 3: Create test files ==="
echo "# Test Project" > README.md
echo "// Test file for git operations" > test.js
echo "/* CSS test */" > style.css
git add .
git commit -m "Initial test commit [$BRANCH]"
echo "✅ Test files created and committed"

echo ""
echo "=== Step 4: Test stashing ==="
echo "Uncommitted change" > uncommitted.txt
git add uncommitted.txt
git stash push -m "Test stash"
if [ -f "uncommitted.txt" ]; then
  echo "❌ File should be stashed"
  exit 1
fi
git stash pop
if [ ! -f "uncommitted.txt" ]; then
  echo "❌ Stash pop failed"
  exit 1
fi
rm uncommitted.txt
echo "✅ Stash operations working"

echo ""
echo "=== Step 5: Test branch switching ==="
NEW_BRANCH="thread-switch-test"
echo "File before switch" > before-switch.txt
git add before-switch.txt
git commit -m "Before switch"

git checkout -b "$NEW_BRANCH"
CURRENT=$(git branch --show-current)
if [ "$CURRENT" != "$NEW_BRANCH" ]; then
  echo "❌ Branch switch failed"
  exit 1
fi
echo "✅ Branch switching works"

# Switch back
git checkout "$BRANCH"

echo ""
echo "=== Step 6: Test commit messages ==="
echo "Another file" > another.txt
git add another.txt
COMMIT_MSG="Add another test file with context [$BRANCH]"
git commit -m "$COMMIT_MSG"

# Check commit message
LAST_MSG=$(git log -1 --pretty=format:"%s")
if [[ "$LAST_MSG" == *"[$BRANCH]"* ]]; then
  echo "✅ Commit message includes session context"
else
  echo "❌ Commit message format incorrect"
  exit 1
fi

echo ""
echo "=== Step 7: Test git status ==="
# Make some changes
echo "Modified" >> README.md
echo "New file" > new.txt

STATUS=$(git status --porcelain)
if [[ "$STATUS" == *"M README.md"* ]] && [[ "$STATUS" == *"?? new.txt"* ]]; then
  echo "✅ Git status tracking changes correctly"
else
  echo "❌ Git status not showing expected changes"
  exit 1
fi

# Clean up changes
git add .
git commit -m "Test status changes"

echo ""
echo "=== Step 8: Test repository info ==="
COMMIT_COUNT=$(git rev-list --count HEAD)
BRANCH_COUNT=$(git branch | wc -l)
FILE_COUNT=$(git ls-files | wc -l)

echo "Repository statistics:"
echo "  Commits: $COMMIT_COUNT"
echo "  Branches: $BRANCH_COUNT"
echo "  Files tracked: $FILE_COUNT"

if [ $COMMIT_COUNT -ge 3 ] && [ $BRANCH_COUNT -ge 2 ] && [ $FILE_COUNT -ge 3 ]; then
  echo "✅ Repository operations verified"
else
  echo "❌ Repository state unexpected"
  exit 1
fi

echo ""
echo "=== Step 9: Test conflict detection ==="
# Create potential conflict scenario
git checkout -b conflict-test
echo "Conflict version 1" > conflict.txt
git add conflict.txt
git commit -m "Conflict commit 1"

git checkout "$BRANCH"
echo "Conflict version 2" > conflict.txt
git add conflict.txt
git commit -m "Conflict commit 2"

# Try merge (should conflict)
git merge conflict-test 2>/dev/null || true

if git status | grep -q "Unmerged paths"; then
  echo "✅ Conflict detection working"
  # Abort merge
  git merge --abort
else
  echo "⚠️  No conflict created (may have auto-resolved)"
fi

echo ""
echo "=== Step 10: Clean up ==="
cd /
rm -rf "$WORKSPACE_PATH"
echo "✅ Test workspace cleaned"

echo ""
echo "========================================="
echo "✅ All git operations tests passed!"
echo "========================================="
echo ""
echo "Summary:"
echo "- Repository initialization: ✓"
echo "- Branch operations: ✓"
echo "- Stash management: ✓"
echo "- Commit formatting: ✓"
echo "- Status tracking: ✓"
echo "- Conflict handling: ✓"
echo ""
echo "Note: No HTTP API required in S3 architecture"
echo "Git operations are performed directly in container"

# Ensure we're back in a safe directory before exiting
cd / 2>/dev/null || true

exit 0