#!/bin/bash
# Test script for git push functionality

echo "Testing Git Push Functionality"
echo "=============================="

# Set test environment
export WORKSPACE_PATH="/tmp/test-workspace"
export CLIENT_ID="ameliastamps"
export USER_ID="scott"
export GITHUB_TOKEN="${GITHUB_TOKEN}"
export GIT_PUSH_ENABLED="true"
export GIT_PUSH_RETRY_COUNT="3"

# Create test workspace
rm -rf $WORKSPACE_PATH
mkdir -p $WORKSPACE_PATH/$CLIENT_ID/$USER_ID

# Clone the repository
echo "1. Cloning repository..."
cd $WORKSPACE_PATH/$CLIENT_ID/$USER_ID
git clone https://${GITHUB_TOKEN}@github.com/jscotthorn/amelia-astro.git
cd amelia-astro

# Configure git
echo "2. Configuring git..."
git config user.email "container@webordinary.com"
git config user.name "WebOrdinary Container"

# Create a test branch
BRANCH="test-push-$(date +%s)"
echo "3. Creating test branch: $BRANCH"
git checkout -b $BRANCH

# Make a test change
echo "4. Making test change..."
echo "// Test push at $(date)" >> test-push.js
git add test-push.js

# Commit the change
echo "5. Committing change..."
git commit -m "[test] Testing push functionality"

# Push to remote
echo "6. Pushing to remote..."
git push origin $BRANCH

if [ $? -eq 0 ]; then
    echo "✅ Push successful! Check https://github.com/jscotthorn/amelia-astro/branches"
    echo "Branch created: $BRANCH"
else
    echo "❌ Push failed!"
    exit 1
fi

# Clean up (optional - keep branch for verification)
# git checkout main
# git branch -D $BRANCH
# git push origin --delete $BRANCH

echo "Test complete!"