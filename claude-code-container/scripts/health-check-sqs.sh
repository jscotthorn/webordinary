#!/bin/bash
# Health check script for SQS-based container
# Returns 0 if healthy, 1 if unhealthy

# Check if main process is running (PID 1 in container)
if [ -d "/proc/1" ] && [ -f "/proc/1/cmdline" ]; then
    echo "Health check passed - Main process running"
    exit 0
else
    echo "ERROR: Main process not running"
    exit 1
fi