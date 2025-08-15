# Multi-stage build for Claude Code container
# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies for build
RUN npm install && \
    npm install -g typescript

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Runtime stage
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install AWS CLI v2 (multi-arch support)
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then \
        curl "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "awscliv2.zip"; \
    else \
        curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"; \
    fi && \
    unzip awscliv2.zip && \
    ./aws/install && \
    rm -rf awscliv2.zip aws/

# Claude Code SDK will be installed via npm dependencies
# No need for global CLI installation

# Create app user for security
RUN useradd -m -s /bin/bash appuser && \
    usermod -aG sudo appuser

# Set up directories with proper ownership
WORKDIR /app
RUN mkdir -p /workspace /tmp/claude && \
    chown -R appuser:appuser /app /workspace /tmp/claude

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Copy scripts and set permissions
COPY scripts/ ./scripts/
RUN chmod +x scripts/*.sh && \
    chown -R appuser:appuser /app/scripts

# Switch to non-root user
USER appuser

# Set up directories appuser can access
RUN mkdir -p ~/.git-credentials-dir

# No ports exposed - container only processes messages

# No health check needed - ECS will monitor task status

# Set environment variables
ENV NODE_ENV=production \
    CLAUDE_CODE_NON_INTERACTIVE=true \
    ASTRO_TELEMETRY_DISABLED=1 \
    CLAUDE_CODE_USE_BEDROCK=1 \
    AWS_REGION=us-west-2

# Add helpful labels
LABEL maintainer="Webordinary <support@webordinary.com>"
LABEL description="Claude Code SDK container for message processing and S3 deployment"
LABEL version="1.0.0"
LABEL component="claude-code-container"

# Entrypoint
ENTRYPOINT ["/app/scripts/entrypoint.sh"]