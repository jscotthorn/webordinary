#!/bin/bash
# Scale up Hermes and Edit containers for development/testing

set -e

echo "🚀 Scaling up WebOrdinary services..."

# Check AWS profile
if [ -z "$AWS_PROFILE" ]; then
    export AWS_PROFILE=personal
    echo "Using AWS profile: personal"
fi

# Scale Hermes to 1
echo "Starting Hermes service..."
aws ecs update-service \
    --cluster webordinary-edit-cluster \
    --service webordinary-hermes-service \
    --desired-count 1 \
    --region us-west-2 \
    --output text

# Scale Edit containers to 2 (pool)
echo "Starting Edit container pool (2 containers)..."
aws ecs update-service \
    --cluster webordinary-edit-cluster \
    --service webordinary-edit-service \
    --desired-count 2 \
    --region us-west-2 \
    --output text

echo "⏳ Waiting for services to start..."
sleep 5

# Check status
echo ""
echo "📊 Current service status:"
aws ecs describe-services \
    --cluster webordinary-edit-cluster \
    --services webordinary-hermes-service webordinary-edit-service \
    --region us-west-2 \
    --query 'services[*].{Service:serviceName,Desired:desiredCount,Running:runningCount,Status:status}' \
    --output table

echo ""
echo "✅ Services are scaling up. Check CloudWatch logs for details:"
echo "   Hermes: https://console.aws.amazon.com/cloudwatch/home?region=us-west-2#logsV2:log-groups/log-group/%252Fecs%252Fhermes"
echo "   Edit:   https://console.aws.amazon.com/cloudwatch/home?region=us-west-2#logsV2:log-groups/log-group/%252Fecs%252Fwebordinary%252Fedit"