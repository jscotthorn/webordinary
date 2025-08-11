#!/bin/bash

# Multi-Session Test Monitor Script
# Monitors git, S3, and container logs during testing

echo "🔍 Multi-Session Test Monitor"
echo "============================="
echo ""

# Configuration
AWS_PROFILE="${AWS_PROFILE:-personal}"
REGION="${AWS_REGION:-us-west-2}"
CLIENT_ID="${CLIENT_ID:-ameliastamps}"
S3_BUCKET="edit.${CLIENT_ID}.webordinary.com"
REPO_PATH="/Users/scott/Projects/webordinary/test-repo-amelia"
LOG_GROUP="/ecs/webordinary/edit"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check git branches
check_git_branches() {
    echo -e "${YELLOW}📚 Git Branches:${NC}"
    if [ -d "$REPO_PATH" ]; then
        cd "$REPO_PATH"
        git fetch --all 2>/dev/null
        git branch -r | grep thread- | tail -5
        echo ""
    else
        echo "Repository not found at $REPO_PATH"
        echo ""
    fi
}

# Function to check recent commits
check_recent_commits() {
    echo -e "${YELLOW}📝 Recent Commits:${NC}"
    if [ -d "$REPO_PATH" ]; then
        cd "$REPO_PATH"
        git log --oneline --all --graph --decorate -10
        echo ""
    fi
}

# Function to check S3 deployment
check_s3_deployment() {
    echo -e "${YELLOW}☁️ S3 Deployment Status:${NC}"
    
    # Get last modified time of index.html
    LAST_MODIFIED=$(AWS_PROFILE=$AWS_PROFILE aws s3api head-object \
        --bucket "$S3_BUCKET" \
        --key "index.html" \
        --query "LastModified" \
        --output text 2>/dev/null)
    
    if [ -n "$LAST_MODIFIED" ]; then
        echo "Last deployment: $LAST_MODIFIED"
        
        # Count total files
        FILE_COUNT=$(AWS_PROFILE=$AWS_PROFILE aws s3 ls "s3://$S3_BUCKET/" \
            --recursive --summarize | grep "Total Objects" | awk '{print $3}')
        echo "Total files: $FILE_COUNT"
    else
        echo -e "${RED}❌ Could not access S3 bucket${NC}"
    fi
    echo ""
}

# Function to check container logs
check_container_logs() {
    echo -e "${YELLOW}📋 Recent Container Logs:${NC}"
    
    AWS_PROFILE=$AWS_PROFILE aws logs tail "$LOG_GROUP" \
        --since 5m \
        --filter-pattern "session" \
        --max-items 10 2>/dev/null | \
        grep -E "(Switched to session|Executing Claude|Pushed branch|ERROR)" | \
        tail -5
    echo ""
}

# Function to check ECS tasks
check_ecs_tasks() {
    echo -e "${YELLOW}🐳 ECS Task Status:${NC}"
    
    TASK_ARN=$(AWS_PROFILE=$AWS_PROFILE aws ecs list-tasks \
        --cluster webordinary-edit-cluster \
        --desired-status RUNNING \
        --query 'taskArns[0]' \
        --output text 2>/dev/null)
    
    if [ -n "$TASK_ARN" ] && [ "$TASK_ARN" != "None" ]; then
        TASK_ID=$(echo $TASK_ARN | rev | cut -d'/' -f1 | rev)
        
        AWS_PROFILE=$AWS_PROFILE aws ecs describe-tasks \
            --cluster webordinary-edit-cluster \
            --tasks "$TASK_ID" \
            --query 'tasks[0].{Status:lastStatus,Health:healthStatus,Started:startedAt}' \
            --output json 2>/dev/null | jq -r '"\(.Status) | Health: \(.Health) | Started: \(.Started)"'
    else
        echo -e "${RED}❌ No running tasks found${NC}"
    fi
    echo ""
}

# Function to check SQS queue
check_sqs_queue() {
    echo -e "${YELLOW}📬 SQS Queue Status:${NC}"
    
    QUEUE_URL="https://sqs.$REGION.amazonaws.com/942734823970/webordinary-email-queue"
    
    MESSAGES=$(AWS_PROFILE=$AWS_PROFILE aws sqs get-queue-attributes \
        --queue-url "$QUEUE_URL" \
        --attribute-names ApproximateNumberOfMessages \
        --query 'Attributes.ApproximateNumberOfMessages' \
        --output text 2>/dev/null)
    
    if [ -n "$MESSAGES" ]; then
        echo "Messages in queue: $MESSAGES"
    else
        echo "Could not access queue"
    fi
    echo ""
}

# Main monitoring loop
monitor_once() {
    clear
    echo "🔍 Multi-Session Test Monitor - $(date '+%Y-%m-%d %H:%M:%S')"
    echo "=============================================="
    echo ""
    
    check_ecs_tasks
    check_sqs_queue
    check_git_branches
    check_recent_commits
    check_s3_deployment
    check_container_logs
}

# Parse arguments
if [ "$1" = "--watch" ]; then
    echo "Starting continuous monitoring (Ctrl+C to stop)..."
    while true; do
        monitor_once
        sleep 10
    done
else
    monitor_once
    echo ""
    echo "Tip: Use '$0 --watch' for continuous monitoring"
fi