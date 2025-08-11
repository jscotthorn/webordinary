#!/bin/bash

# Test script to verify S3 sync functionality
# Run this inside the container to test the build and deploy process

set -e

echo "🧪 Testing S3 Sync Functionality"
echo "================================"

# Check environment
echo "📋 Environment Check:"
echo "- NODE_ENV: ${NODE_ENV:-not set}"
echo "- AWS_PROFILE: ${AWS_PROFILE:-not set}"
echo "- CLIENT_ID: ${CLIENT_ID:-${DEFAULT_CLIENT_ID:-amelia}}"
echo "- WORKSPACE_PATH: ${WORKSPACE_PATH:-/workspace}"

# Verify AWS access
echo ""
echo "🔐 AWS Access Check:"
if aws sts get-caller-identity > /dev/null 2>&1; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    REGION=$(aws configure get region || echo "us-west-2")
    echo "✅ AWS access working (Account: $ACCOUNT_ID, Region: $REGION)"
else
    echo "❌ AWS access failed"
    exit 1
fi

# Check S3 bucket
BUCKET_NAME="edit.${CLIENT_ID:-${DEFAULT_CLIENT_ID:-amelia}}.webordinary.com"
echo ""
echo "🪣 S3 Bucket Check:"
if aws s3 ls s3://${BUCKET_NAME} > /dev/null 2>&1; then
    echo "✅ S3 bucket ${BUCKET_NAME} is accessible"
else
    echo "❌ S3 bucket ${BUCKET_NAME} not accessible"
    exit 1
fi

# Navigate to workspace
WORKSPACE="${WORKSPACE_PATH:-/workspace}"
if [ ! -d "$WORKSPACE" ]; then
    echo "❌ Workspace directory not found: $WORKSPACE"
    exit 1
fi

cd "$WORKSPACE"
echo ""
echo "📁 Workspace contents:"
ls -la

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "❌ No package.json found in workspace"
    echo "Please ensure an Astro project is mounted at $WORKSPACE"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo ""
    echo "📦 Installing dependencies..."
    npm install
fi

# Build the Astro project
echo ""
echo "🔨 Building Astro project..."
time npm run build

# Check if dist directory was created
if [ ! -d "dist" ]; then
    echo "❌ Build failed - no dist directory created"
    exit 1
fi

echo ""
echo "✅ Build successful!"
echo "📊 Build output:"
du -sh dist
find dist -type f | wc -l | xargs echo "Total files:"

# Sync to S3
echo ""
echo "☁️ Syncing to S3..."
time aws s3 sync dist s3://${BUCKET_NAME} --delete --region ${REGION:-us-west-2}

echo ""
echo "✅ S3 sync complete!"
echo ""
echo "🌐 Site should be available at:"
echo "   https://${BUCKET_NAME}"
echo ""
echo "📋 S3 bucket contents (first 20 files):"
aws s3 ls s3://${BUCKET_NAME}/ --recursive | head -20

echo ""
echo "🎉 All tests passed successfully!"