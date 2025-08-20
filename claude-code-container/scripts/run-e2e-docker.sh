#!/bin/bash

# E2E Test Runner using Docker container
# This script runs the claude-code-container in Docker with proper AWS credentials

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WORKSPACE_DIR="${PROJECT_ROOT}/workspace"

# Function to print colored output
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Cleanup function
cleanup() {
    print_info "Cleaning up..."
    cd "$PROJECT_ROOT"
    docker-compose -f docker-compose.test.yml down --volumes --remove-orphans || true
    print_info "Cleanup complete"
}

# Set trap for cleanup
trap cleanup EXIT INT TERM

# Check required environment variables
check_env() {
    local missing=()
    
    if [[ -z "${GITHUB_TOKEN:-}" ]]; then
        missing+=("GITHUB_TOKEN")
    fi
    
    if [[ -z "${AWS_PROFILE:-}" ]] && [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
        missing+=("AWS_PROFILE or AWS_ACCESS_KEY_ID")
    fi
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        print_error "Missing required environment variables: ${missing[*]}"
        print_info "Please set the following:"
        print_info "  export GITHUB_TOKEN=your_github_token"
        print_info "  export AWS_PROFILE=personal  # or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY"
        exit 1
    fi
}

# Export AWS credentials from profile if needed
export_aws_credentials() {
    if [[ -n "${AWS_PROFILE:-}" ]] && [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
        print_info "Exporting AWS credentials from profile: $AWS_PROFILE"
        
        # Get credentials from AWS CLI
        local creds=$(aws configure export-credentials --profile "$AWS_PROFILE" 2>/dev/null || true)
        
        if [[ -n "$creds" ]]; then
            export AWS_ACCESS_KEY_ID=$(echo "$creds" | jq -r '.AccessKeyId')
            export AWS_SECRET_ACCESS_KEY=$(echo "$creds" | jq -r '.SecretAccessKey')
            export AWS_SESSION_TOKEN=$(echo "$creds" | jq -r '.SessionToken // empty')
        else
            # Fallback to reading from credentials file
            export AWS_ACCESS_KEY_ID=$(aws configure get aws_access_key_id --profile "$AWS_PROFILE")
            export AWS_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key --profile "$AWS_PROFILE")
        fi
    fi
}

# Build Docker image
build_image() {
    print_info "Building Docker image..."
    cd "$PROJECT_ROOT"
    
    # Build TypeScript first
    if [[ ! -d "dist" ]] || [[ "$1" == "rebuild" ]]; then
        print_info "Building TypeScript..."
        npm run build
    fi
    
    # Build Docker image
    docker-compose -f docker-compose.test.yml build --no-cache
    print_info "Docker image built successfully"
}

# Setup workspace
setup_workspace() {
    print_info "Setting up workspace..."
    
    # Create workspace directory if it doesn't exist
    mkdir -p "$WORKSPACE_DIR"
    
    # Clean workspace
    rm -rf "$WORKSPACE_DIR"/*
    
    print_info "Workspace ready at: $WORKSPACE_DIR"
}

# Run container with test message
run_test() {
    local test_type="${1:-basic}"
    
    print_info "Running test: $test_type"
    
    # Set queue URLs based on environment
    export UNCLAIMED_QUEUE_URL="${UNCLAIMED_QUEUE_URL:-https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed}"
    export INPUT_QUEUE_URL="${INPUT_QUEUE_URL:-https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-input}"
    export OUTPUT_QUEUE_URL="${OUTPUT_QUEUE_URL:-https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-output}"
    export INTERRUPT_QUEUE_URL="${INTERRUPT_QUEUE_URL:-https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-interrupt}"
    
    # Create test message based on type
    case "$test_type" in
        "basic")
            create_basic_test_message
            ;;
        "s3")
            create_s3_test_message
            ;;
        "stepfunction")
            create_stepfunction_test_message
            ;;
        *)
            print_error "Unknown test type: $test_type"
            exit 1
            ;;
    esac
    
    # Run container
    print_info "Starting container..."
    cd "$PROJECT_ROOT"
    
    # Run with timeout
    timeout 300 docker-compose -f docker-compose.test.yml up --abort-on-container-exit || {
        local exit_code=$?
        if [[ $exit_code -eq 124 ]]; then
            print_warn "Container timed out after 5 minutes"
        else
            print_error "Container exited with code: $exit_code"
        fi
        return $exit_code
    }
    
    print_info "Test completed"
}

# Create basic test message
create_basic_test_message() {
    print_info "Creating basic test message..."
    
    # This would normally send a message to the queue
    # For now, we'll create a test file that the container can process
    cat > "$WORKSPACE_DIR/test-message.json" <<EOF
{
    "projectId": "amelia",
    "userId": "test-user",
    "chatThreadId": "test-thread-$(date +%s)",
    "message": "Create a simple index.html file with Hello World",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
}

# Create S3 deployment test message
create_s3_test_message() {
    print_info "Creating S3 deployment test message..."
    
    cat > "$WORKSPACE_DIR/test-message.json" <<EOF
{
    "projectId": "amelia",
    "userId": "test-user",
    "chatThreadId": "test-s3-$(date +%s)",
    "message": "Create an Astro site with a homepage and deploy to S3",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "deployToS3": true
}
EOF
}

# Create Step Function callback test message
create_stepfunction_test_message() {
    print_info "Creating Step Function test message..."
    
    # Generate a mock task token
    local task_token="AAAAKgAAAAIAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAEAAABhAAAAAAADw8fQ"
    
    cat > "$WORKSPACE_DIR/test-message.json" <<EOF
{
    "projectId": "amelia",
    "userId": "test-user",
    "chatThreadId": "test-sf-$(date +%s)",
    "message": "Create a simple test file",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "taskToken": "$task_token",
    "messageId": "test-msg-$(date +%s)"
}
EOF
    
    export TASK_TOKEN="$task_token"
}

# View container logs
view_logs() {
    print_info "Container logs:"
    docker-compose -f docker-compose.test.yml logs --tail=50
}

# Main execution
main() {
    print_info "Starting E2E Docker test..."
    
    # Parse arguments
    local action="${1:-test}"
    local test_type="${2:-basic}"
    
    case "$action" in
        "build")
            check_env
            build_image "rebuild"
            ;;
        "test")
            check_env
            export_aws_credentials
            setup_workspace
            build_image
            run_test "$test_type"
            view_logs
            ;;
        "logs")
            view_logs
            ;;
        "clean")
            cleanup
            ;;
        *)
            print_error "Unknown action: $action"
            print_info "Usage: $0 [build|test|logs|clean] [test_type]"
            print_info "Test types: basic, s3, stepfunction"
            exit 1
            ;;
    esac
    
    print_info "Done!"
}

# Run main function
main "$@"