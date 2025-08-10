#!/bin/bash

# Build script for Claude Code Container with SQS support

set -e

# Configuration
REGISTRY="942734823970.dkr.ecr.us-west-2.amazonaws.com"
IMAGE_NAME="webordinary/claude-code-sqs"
TAG="${1:-latest}"

echo "Building Claude Code Container with SQS support..."
echo "Registry: $REGISTRY"
echo "Image: $IMAGE_NAME:$TAG"

# Build the Docker image
echo "Building Docker image..."
docker build -f Dockerfile.sqs -t $IMAGE_NAME:$TAG .

# Tag for ECR
echo "Tagging for ECR..."
docker tag $IMAGE_NAME:$TAG $REGISTRY/$IMAGE_NAME:$TAG

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region us-west-2 --profile personal | docker login --username AWS --password-stdin $REGISTRY

# Push to ECR
echo "Pushing to ECR..."
docker push $REGISTRY/$IMAGE_NAME:$TAG

echo "Build complete!"
echo ""
echo "To test locally:"
echo "  docker run -e INPUT_QUEUE_URL=<queue-url> -e OUTPUT_QUEUE_URL=<queue-url> $IMAGE_NAME:$TAG"
echo ""
echo "To deploy to Fargate:"
echo "  Update task definition to use: $REGISTRY/$IMAGE_NAME:$TAG"