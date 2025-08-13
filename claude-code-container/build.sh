#!/bin/bash
# Build and push Claude Code Docker container

set -e

echo "=== Claude Code Container Build Script ==="

# Get ECR repository URI from Task 00 CloudFormation outputs
echo "Getting ECR repository URI..."
ECR_URI=$(aws cloudformation describe-stacks \
  --stack-name ECRStack \
  --query 'Stacks[0].Outputs[?OutputKey==`RepositoryUri`].OutputValue' \
  --output text \
  --profile personal)

if [ -z "$ECR_URI" ]; then
  echo "Error: Could not get ECR repository URI from CloudFormation"
  echo "Make sure Task 00 is deployed successfully"
  exit 1
fi

echo "ECR Repository: $ECR_URI"

# Build the Docker image locally
echo "Building Docker image..."
docker build -t webordinary/claude-code-astro:latest .

if [ $? -ne 0 ]; then
  echo "Error: Docker build failed"
  exit 1
fi

echo "Docker image built successfully"

# Get image size
IMAGE_SIZE=$(docker images webordinary/claude-code-astro:latest --format "{{.Size}}")
echo "Image size: $IMAGE_SIZE"

# Tag for ECR
echo "Tagging image for ECR..."
docker tag webordinary/claude-code-astro:latest $ECR_URI:latest
docker tag webordinary/claude-code-astro:latest $ECR_URI:v1.0.0

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region us-west-2 --profile personal | \
  docker login --username AWS --password-stdin $ECR_URI

if [ $? -ne 0 ]; then
  echo "Error: ECR login failed"
  exit 1
fi

echo "Successfully logged in to ECR"

# Push to ECR
echo "Pushing images to ECR..."
docker push $ECR_URI:latest

if [ $? -ne 0 ]; then
  echo "Error: Failed to push latest tag"
  exit 1
fi

docker push $ECR_URI:v1.0.0

if [ $? -ne 0 ]; then
  echo "Error: Failed to push version tag"
  exit 1
fi

echo "=== Build Complete ==="
echo "Image: $ECR_URI:latest"
echo "Version: $ECR_URI:v1.0.0"
echo "Size: $IMAGE_SIZE"
echo ""
echo "To run locally for testing:"
echo "docker run -v \$(pwd)/test-workspace:/workspace webordinary/claude-code-astro:latest"
echo "Note: Container no longer serves HTTP. Uses SQS for communication."
echo ""
echo "Next: Deploy with Fargate in Task 02"