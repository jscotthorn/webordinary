# REPO_URL Environment Variable Removal
**Completed**: 2025-01-13

## Problem
Containers expected REPO_URL from environment (old architecture) instead of messages (new architecture).

## Changes Made

### claude-code-container
- `src/main.ts`: Removed lines 25-34 checking for `process.env.REPO_URL`
- `.env.local.example`: Removed legacy variables, documented changes

### hephaestus
- `lib/fargate-stack.ts`: Removed REPO_URL, DEFAULT_CLIENT_ID, DEFAULT_USER_ID from task definition

### hermes
- `src/modules/container/container-manager.service.ts`: Removed REPO_URL passing, deleted getRepoUrl()
- `src/modules/edit-session/services/fargate-manager.service.ts`: Removed environment overrides
- `.env.local.example`: Removed CLAUDE_CODE_CONTAINER_URL, WORKSPACE_PATH

## Result
✅ Containers start without REPO_URL
✅ Repository URL comes from message.repoUrl
✅ Containers are generic, claim work dynamically

## Deploy Steps
```bash
npx cdk deploy FargateStack --profile personal
docker build --platform linux/amd64 -t webordinary/claude-code-astro .
docker push [ECR_URI]
aws ecs update-service --cluster webordinary-edit-cluster --service webordinary-edit-service --force-new-deployment
```