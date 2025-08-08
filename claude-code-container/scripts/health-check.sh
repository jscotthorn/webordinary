#!/bin/bash
# /app/scripts/health-check.sh

# Health check script for Docker container

# Check if the main server is responding
if curl -f -s http://localhost:8080/health > /dev/null 2>&1; then
  echo "Health check passed"
  exit 0
else
  echo "Health check failed - server not responding"
  exit 1
fi