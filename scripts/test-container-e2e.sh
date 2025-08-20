#!/bin/bash

# E2E Container Test Runner
# Runs claude-code-container in Docker with AWS credentials and GitHub token

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTAINER_DIR="${PROJECT_ROOT}/claude-code-container"

print_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }
print_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Check prerequisites
check_requirements() {
    local missing=()
    
    # Check for Docker
    if ! command -v docker &> /dev/null; then
        missing+=("docker")
    fi
    
    # Check for AWS CLI
    if ! command -v aws &> /dev/null; then
        missing+=("aws-cli")
    fi
    
    # Check environment variables
    if [[ -z "${GITHUB_TOKEN:-}" ]]; then
        missing+=("GITHUB_TOKEN environment variable")
    fi
    
    if [[ -z "${AWS_PROFILE:-}" ]] && [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
        missing+=("AWS_PROFILE or AWS credentials")
    fi
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        print_error "Missing requirements: ${missing[*]}"
        exit 1
    fi
}

# Export AWS credentials from profile
setup_aws_credentials() {
    if [[ -n "${AWS_PROFILE:-}" ]] && [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
        print_info "Using AWS profile: $AWS_PROFILE"
        
        # Export credentials for Docker
        export AWS_ACCESS_KEY_ID=$(aws configure get aws_access_key_id --profile "$AWS_PROFILE")
        export AWS_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key --profile "$AWS_PROFILE")
        export AWS_REGION=${AWS_REGION:-us-west-2}
    fi
}

# Build container
build_container() {
    print_info "Building claude-code-container..."
    
    cd "$CONTAINER_DIR"
    
    # Build TypeScript
    if [[ ! -d "dist" ]] || [[ "${REBUILD:-}" == "true" ]]; then
        print_info "Building TypeScript..."
        npm run build
    fi
    
    # Build Docker image
    docker build --platform linux/amd64 -t webordinary/claude-code-test:latest .
    
    print_info "Container built successfully"
}

# Run container test
run_container_test() {
    local test_type="${1:-basic}"
    
    print_info "Running container test: $test_type"
    
    cd "$CONTAINER_DIR"
    
    # Create workspace
    rm -rf workspace
    mkdir -p workspace
    
    # Set queue URLs
    local UNCLAIMED_QUEUE="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed"
    local INPUT_QUEUE="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-input"
    local OUTPUT_QUEUE="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-output"
    local INTERRUPT_QUEUE="https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-interrupt"
    
    # Run container with environment
    docker run --rm \
        --name claude-code-e2e \
        -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
        -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
        -e AWS_REGION="${AWS_REGION:-us-west-2}" \
        -e GITHUB_TOKEN="$GITHUB_TOKEN" \
        -e UNCLAIMED_QUEUE_URL="$UNCLAIMED_QUEUE" \
        -e INPUT_QUEUE_URL="$INPUT_QUEUE" \
        -e OUTPUT_QUEUE_URL="$OUTPUT_QUEUE" \
        -e INTERRUPT_QUEUE_URL="$INTERRUPT_QUEUE" \
        -e THREAD_MAPPINGS_TABLE="webordinary-thread-mappings" \
        -e CONTAINERS_TABLE="webordinary-containers" \
        -e S3_BUCKET_PREFIX="edit" \
        -e S3_BUCKET_SUFFIX="webordinary.com" \
        -e CLAUDE_CODE_NON_INTERACTIVE="true" \
        -e CLAUDE_CODE_USE_BEDROCK="1" \
        -e NODE_ENV="test" \
        -e LOG_LEVEL="debug" \
        -v "${CONTAINER_DIR}/workspace:/workspace" \
        -v "${HOME}/.aws:/home/appuser/.aws:ro" \
        webordinary/claude-code-test:latest \
        || {
            local exit_code=$?
            print_error "Container exited with code: $exit_code"
            docker logs claude-code-e2e 2>&1 | tail -50
            return $exit_code
        }
    
    print_info "Test completed successfully"
}

# View logs
view_logs() {
    print_info "Fetching container logs..."
    docker logs claude-code-e2e 2>&1 | tail -100
}

# Cleanup
cleanup() {
    print_info "Cleaning up..."
    docker stop claude-code-e2e 2>/dev/null || true
    docker rm claude-code-e2e 2>/dev/null || true
    print_info "Cleanup complete"
}

# Main
main() {
    local action="${1:-test}"
    
    case "$action" in
        test)
            check_requirements
            setup_aws_credentials
            build_container
            run_container_test "${2:-basic}"
            ;;
        build)
            check_requirements
            build_container
            ;;
        logs)
            view_logs
            ;;
        clean)
            cleanup
            ;;
        *)
            print_error "Unknown action: $action"
            echo "Usage: $0 [test|build|logs|clean] [test_type]"
            exit 1
            ;;
    esac
}

# Handle cleanup on exit
trap cleanup EXIT INT TERM

# Run
main "$@"