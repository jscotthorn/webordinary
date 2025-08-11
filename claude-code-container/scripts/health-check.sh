#!/bin/bash
# /app/scripts/health-check.sh
# SQS-based health check script (no HTTP server)

set -e

# Check if Astro dev server is running
if curl -f -s http://localhost:4321 > /dev/null 2>&1; then
  echo "✓ Astro dev server responding on port 4321"
else
  echo "✗ Astro dev server not responding on port 4321"
  exit 1
fi

# Check if the main Node.js process is running
if pgrep -f "node /app/dist/main.js" > /dev/null; then
  echo "✓ SQS processor is running"
else
  echo "✗ SQS processor is not running"
  exit 1
fi

# Check workspace directory is accessible
if [ -d "/workspace" ]; then
  echo "✓ Workspace directory accessible"
else
  echo "✗ Workspace directory not accessible"
  exit 1
fi

echo "Health check passed - Container ready for SQS processing"
exit 0