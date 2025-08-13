#!/bin/bash

# Build script for container with claim mechanism
# This builds and pushes the container with the new queue claim functionality

set -e

# Configuration
ECR_REGISTRY="942734823970.dkr.ecr.us-west-2.amazonaws.com"
ECR_REPO="webordinary/claude-code-astro"
TAG="claim-v1"
PLATFORM="linux/amd64"

echo "🔨 Building container with claim mechanism..."
echo "  Platform: $PLATFORM"
echo "  Tag: $TAG"

# Ensure we're in the right directory
cd "$(dirname "$0")"

# Build the container (MUST use platform flag for ECS)
echo "📦 Building Docker image..."
docker build --platform $PLATFORM -t $ECR_REPO:$TAG .

if [ $? -ne 0 ]; then
    echo "❌ Docker build failed"
    exit 1
fi

echo "✅ Build successful"

# Tag for ECR
echo "🏷️  Tagging for ECR..."
docker tag $ECR_REPO:$TAG $ECR_REGISTRY/$ECR_REPO:$TAG
docker tag $ECR_REPO:$TAG $ECR_REGISTRY/$ECR_REPO:latest

# Login to ECR
echo "🔐 Logging in to ECR..."
aws ecr get-login-password --region us-west-2 --profile personal | \
    docker login --username AWS --password-stdin $ECR_REGISTRY

if [ $? -ne 0 ]; then
    echo "❌ ECR login failed"
    exit 1
fi

# Push to ECR
echo "📤 Pushing to ECR..."
docker push $ECR_REGISTRY/$ECR_REPO:$TAG
docker push $ECR_REGISTRY/$ECR_REPO:latest

if [ $? -ne 0 ]; then
    echo "❌ Docker push failed"
    exit 1
fi

echo "✅ Successfully pushed $ECR_REPO:$TAG to ECR"
echo ""
echo "📝 Next steps:"
echo "1. Deploy infrastructure: cd ../hephaestus && npx cdk deploy SqsStack FargateStack --profile personal"
echo "2. Scale up service: AWS_PROFILE=personal aws ecs update-service --cluster webordinary-edit-cluster --service webordinary-edit-service --desired-count 1"
echo "3. Test with email to buddy@webordinary.com"