#!/bin/bash
# Check status of WebOrdinary services

set -e

# Check AWS profile
if [ -z "$AWS_PROFILE" ]; then
    export AWS_PROFILE=personal
fi

echo "🔍 WebOrdinary Service Status"
echo "=============================="
echo ""

# Service status
echo "📊 ECS Services:"
aws ecs describe-services \
    --cluster webordinary-edit-cluster \
    --services webordinary-hermes-service webordinary-edit-service \
    --region us-west-2 \
    --query 'services[*].{Service:serviceName,Desired:desiredCount,Running:runningCount,Pending:pendingCount,Status:status}' \
    --output table

# Running tasks
echo ""
echo "🏃 Running Tasks:"
TASK_ARNS=$(aws ecs list-tasks \
    --cluster webordinary-edit-cluster \
    --desired-status RUNNING \
    --region us-west-2 \
    --query 'taskArns' \
    --output text)

if [ -z "$TASK_ARNS" ]; then
    echo "   No tasks currently running"
else
    aws ecs describe-tasks \
        --cluster webordinary-edit-cluster \
        --tasks $TASK_ARNS \
        --region us-west-2 \
        --query 'tasks[*].{Task:taskArn,Status:lastStatus,Container:containers[0].name,Health:healthStatus}' \
        --output table
fi

# Active sessions
echo ""
echo "📝 Active Sessions (last 5):"
aws dynamodb scan \
    --table-name webordinary-edit-sessions \
    --limit 5 \
    --region us-west-2 \
    --query 'Items[*].{SessionId:sessionId.S,Status:status.S,ClientId:clientId.S,Created:createdAt.N}' \
    --output table 2>/dev/null || echo "   Session table not found or empty"

# SQS queue status
echo ""
echo "📬 SQS Queue Status:"
QUEUE_URL="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-queue"
if aws sqs get-queue-attributes --queue-url $QUEUE_URL --attribute-names ApproximateNumberOfMessages --region us-west-2 >/dev/null 2>&1; then
    MSG_COUNT=$(aws sqs get-queue-attributes \
        --queue-url $QUEUE_URL \
        --attribute-names ApproximateNumberOfMessages \
        --region us-west-2 \
        --query 'Attributes.ApproximateNumberOfMessages' \
        --output text)
    echo "   Email queue: $MSG_COUNT messages pending"
else
    echo "   Email queue not found"
fi

# Cost estimate
echo ""
echo "💰 Current Estimated Monthly Cost:"
HERMES_COUNT=$(aws ecs describe-services --cluster webordinary-edit-cluster --services webordinary-hermes-service --region us-west-2 --query 'services[0].runningCount' --output text)
EDIT_COUNT=$(aws ecs describe-services --cluster webordinary-edit-cluster --services webordinary-edit-service --region us-west-2 --query 'services[0].runningCount' --output text)

HERMES_COST=$(echo "$HERMES_COUNT * 15" | bc)
EDIT_COST=$(echo "$EDIT_COUNT * 45" | bc)
TOTAL_COST=$(echo "$HERMES_COST + $EDIT_COST + 26" | bc)  # +26 for base infrastructure

echo "   Hermes ($HERMES_COUNT running):     ~\$$HERMES_COST/month"
echo "   Edit ($EDIT_COUNT running):       ~\$$EDIT_COST/month"
echo "   Base Infrastructure:    ~\$26/month"
echo "   --------------------------------"
echo "   Total:                  ~\$$TOTAL_COST/month"