#!/bin/bash

# Script to run tests with the personal AWS profile
# This ensures all tests use the correct AWS credentials

echo "🔧 Setting up test environment with AWS_PROFILE=personal"
export AWS_PROFILE=personal
export AWS_REGION=us-west-2

# Verify AWS credentials are working
echo "🔐 Verifying AWS credentials..."
if aws sts get-caller-identity > /dev/null 2>&1; then
    echo "✅ AWS credentials verified"
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    echo "   Account: $ACCOUNT_ID"
else
    echo "❌ AWS credentials not working. Please configure your personal profile."
    exit 1
fi

# Run the test command passed as arguments
if [ $# -eq 0 ]; then
    echo ""
    echo "Usage: ./test-with-profile.sh [test-command]"
    echo ""
    echo "Examples:"
    echo "  ./test-with-profile.sh all        # Run all tests"
    echo "  ./test-with-profile.sh container  # Run container test"
    echo "  ./test-with-profile.sh integration # Run integration tests"
    echo ""
    echo "Running all tests by default..."
    npm test all
else
    npm test "$@"
fi