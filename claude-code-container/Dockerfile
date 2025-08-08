# Multi-stage build for Claude Code container
# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install build dependencies
RUN npm ci --only=production && \
    npm install -g typescript tsx

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
    python3 \
    python3-pip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally (for Task 03 integration)
# For now, we'll create a placeholder since we're using simulation
RUN mkdir -p /usr/local/bin && \
    echo '#!/bin/bash\necho "Claude Code CLI placeholder - will be replaced with Bedrock integration in Task 03"' > /usr/local/bin/claude-code && \
    chmod +x /usr/local/bin/claude-code

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

# Expose ports
EXPOSE 8080 4321 4322

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD /app/scripts/health-check.sh

# Set environment variables
ENV NODE_ENV=production \
    CLAUDE_CODE_NON_INTERACTIVE=true \
    ASTRO_TELEMETRY_DISABLED=1 \
    PORT=8080

# Add helpful labels
LABEL maintainer="Webordinary <support@webordinary.com>"
LABEL description="Claude Code SDK container with Astro dev server for live editing"
LABEL version="1.0.0"
LABEL component="claude-code-container"

# Entrypoint
ENTRYPOINT ["/app/scripts/entrypoint.sh"]