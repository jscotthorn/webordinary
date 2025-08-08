#!/bin/bash
# /app/scripts/auto-shutdown.sh
# 
# DEPRECATED: This simple auto-shutdown approach is being replaced with
# a DynamoDB-driven cleanup system managed by a Lambda cron job.
#
# The new approach will:
# 1. Query DynamoDB for customer/workspace status
# 2. Determine which workspaces are eligible for cleanup
# 3. Grant specific file system permissions only to authorized folders
# 4. Use proper AWS resource management instead of container self-termination

IDLE_TIMEOUT=${AUTO_SHUTDOWN_MINUTES:-30}  # Increased default timeout
LAST_ACTIVITY_FILE="/tmp/last_activity"
CHECK_INTERVAL=60  # Check every 60 seconds

echo "⚠️  LEGACY: Auto-shutdown monitor started (timeout: ${IDLE_TIMEOUT} minutes)"
echo "📋 NOTE: This will be replaced with DynamoDB-driven cleanup system"

# Initialize activity timestamp
date +%s > $LAST_ACTIVITY_FILE

while true; do
  sleep $CHECK_INTERVAL
  
  # Get last activity time
  if [ -f "$LAST_ACTIVITY_FILE" ]; then
    LAST_ACTIVITY=$(cat $LAST_ACTIVITY_FILE 2>/dev/null || echo 0)
  else
    LAST_ACTIVITY=0
  fi
  
  CURRENT_TIME=$(date +%s)
  IDLE_TIME=$((CURRENT_TIME - LAST_ACTIVITY))
  IDLE_MINUTES=$((IDLE_TIME / 60))
  
  # Check if we've been idle too long
  if [ $IDLE_MINUTES -ge $IDLE_TIMEOUT ]; then
    echo "Container idle for $IDLE_MINUTES minutes (timeout: $IDLE_TIMEOUT)"
    echo "📝 In production, this will be handled by DynamoDB-driven cleanup"
    
    # Instead of self-termination, update DynamoDB with idle status
    # This allows the cron job to make informed cleanup decisions
    if [ -n "$WORKSPACE_STATUS_TABLE" ] && [ -n "$CLIENT_ID" ] && [ -n "$USER_ID" ]; then
      echo "📊 Reporting idle status to DynamoDB..."
      aws dynamodb update-item \
        --table-name "$WORKSPACE_STATUS_TABLE" \
        --key '{"clientId":{"S":"'$CLIENT_ID'"},"userId":{"S":"'$USER_ID'"}}' \
        --update-expression "SET lastActivity = :timestamp, containerStatus = :status" \
        --expression-attribute-values '{
          ":timestamp":{"N":"'$CURRENT_TIME'"},
          ":status":{"S":"idle"}
        }' \
        --region "$AWS_REGION" 2>/dev/null || echo "⚠️  Could not update DynamoDB status"
    fi
    
    # Log for monitoring
    echo "$(date): Container reported idle status after ${IDLE_MINUTES} minutes" >> /tmp/activity.log
    
    # In development/testing, still allow self-shutdown after extended idle
    if [ $IDLE_MINUTES -ge $((IDLE_TIMEOUT * 2)) ]; then
      echo "🛑 Extended idle period reached, initiating graceful shutdown..."
      kill -TERM 1
      sleep 10
      exit 0
    fi
  else
    # Update activity status in DynamoDB if available
    if [ -n "$WORKSPACE_STATUS_TABLE" ] && [ -n "$CLIENT_ID" ] && [ -n "$USER_ID" ] && [ $((IDLE_MINUTES % 10)) -eq 0 ]; then
      aws dynamodb update-item \
        --table-name "$WORKSPACE_STATUS_TABLE" \
        --key '{"clientId":{"S":"'$CLIENT_ID'"},"userId":{"S":"'$USER_ID'"}}' \
        --update-expression "SET lastActivity = :timestamp, containerStatus = :status" \
        --expression-attribute-values '{
          ":timestamp":{"N":"'$LAST_ACTIVITY'"},
          ":status":{"S":"active"}
        }' \
        --region "$AWS_REGION" 2>/dev/null || true
    fi
  fi
  
  # Log activity check (only every 10 minutes to reduce noise)
  if [ $((IDLE_MINUTES % 10)) -eq 0 ] && [ $IDLE_MINUTES -gt 0 ]; then
    echo "📊 Activity check: idle for ${IDLE_MINUTES}/${IDLE_TIMEOUT} minutes"
  fi
done