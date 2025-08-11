#!/bin/bash

# Test S3 sync functionality inside container
echo "Testing S3 sync inside container..."

# Check AWS CLI
if command -v aws &> /dev/null; then
    echo "✅ AWS CLI available"
    aws --version
else
    echo "❌ AWS CLI not found"
    exit 1
fi

# Check AWS credentials
if aws sts get-caller-identity > /dev/null 2>&1; then
    echo "✅ AWS credentials working"
else
    echo "⚠️  AWS credentials not configured (expected in test mode)"
fi

# Check workspace
if [ -d "$WORKSPACE_PATH" ]; then
    echo "✅ Workspace exists: $WORKSPACE_PATH"
else
    echo "❌ Workspace not found: $WORKSPACE_PATH"
    exit 1
fi

echo "✅ S3 sync test complete"