#!/bin/bash
# Scale down all services to 0 for cost savings

set -e

echo "📉 Scaling down WebOrdinary services to 0..."

# Check AWS profile
if [ -z "$AWS_PROFILE" ]; then
    export AWS_PROFILE=personal
    echo "Using AWS profile: personal"
fi

# Scale Edit containers to 0
echo "Stopping Edit containers..."
aws ecs update-service \
    --cluster webordinary-edit-cluster \
    --service webordinary-edit-service \
    --desired-count 0 \
    --region us-west-2 \
    --output text

echo "⏳ Waiting for services to stop..."
sleep 5

# Check status
echo ""
echo "📊 Current service status:"
aws ecs describe-services \
    --cluster webordinary-edit-cluster \
    --services webordinary-edit-service \
    --region us-west-2 \
    --query 'services[*].{Service:serviceName,Desired:desiredCount,Running:runningCount,Status:status}' \
    --output table

# Calculate monthly savings
echo ""
echo "💰 Cost Savings:"
echo "   Edit (1 x 2vCPU, 4GB):    ~\$45-50/month saved"
echo "   Total:                    ~\$45-50/month saved when idle"

echo ""
echo "✅ All services scaled to 0. Run ./scale-up.sh to restart."