# WebOrdinary

An AI Agent-based CMS SaaS platform. Users subscribe for an intelligent website host that will take natural language instructions to manage their website. Astro-based websites that are statically rendered for prod and scaled down development environments. Claude Code is used in fargate pods to respond to user instructions, with plan confirmation for large requests, and non-prod user-based environment urls for staging before going to production.

## 🏗️ Current Architecture

### Production Deployments

#### Amelia Stamps (First Client) - Live at amelia.webordinary.com
```
GitHub (ameliastamps/amelia-astro)
    ↓ webhook
Lambda Build Function (HephaestusBuildFunction)
    ↓ build & deploy
S3 Bucket (amelia.webordinary.com)
    ↓ origin
CloudFront CDN (E3FW6R4G95TKO2)
    ↓ HTTPS
Route53 DNS → https://amelia.webordinary.com
```

**Live URLs:**
- Production: https://amelia.webordinary.com
- Editor: https://edit.amelia.webordinary.com (on-demand)

### Infrastructure Components

#### Core Services (Sprint 1 Complete)
1. **ECR Repository**: `webordinary/claude-code-astro` - Docker images
2. **EFS Filesystem**: Persistent workspace storage across sessions
3. **ALB + SSL**: `*.webordinary.com` certificate, HTTPS routing
4. **Fargate Cluster**: Auto-scaling containers (0-3 tasks)
5. **Lambda Build**: GitHub webhook → Astro build → S3 deploy
6. **CloudFront CDN**: Global distribution with caching
7. **Route53 DNS**: Domain routing and management

#### Container Architecture
```
Claude Code Container (Task 01)
├── ThreadManager: User workspace & git branch isolation
├── AstroManager: Dev server lifecycle & HMR
├── ClaudeExecutor: Bedrock integration (Task 03)
└── Express API: RESTful endpoints on port 8080

Fargate Service (Task 02)
├── Auto-scaling: 0-3 tasks based on load
├── EFS Mount: /workspace persistent storage
├── Ports: 8080 (API), 4321 (Astro), 4322 (WebSocket)
└── Auto-shutdown: 5-minute idle timeout
```

### Configuration
- Environment variables are loaded via `dotenv` in both projects
- AWS credentials and regions are configured through environment variables
- Hermes uses NestJS ConfigService for centralized configuration management

### Key Dependencies
- **Hephaestus**: AWS CDK, TypeScript, Jest
- **Hermes**: NestJS, AWS SDK, LangChain, Jest, ESLint, Prettier

## Testing
Both projects use Jest for testing:
- Unit tests follow the pattern `*.spec.ts`
- E2E tests in Hermes use `jest-e2e.json` configuration
- Coverage reports are generated in `/coverage` directory

## Hermes Agent Architecture

The Hermes agent uses LangGraphJS to implement a plan-and-execute pattern with human-in-the-loop capabilities:

### State Management
- **SiteState**: Tracks email, messages, plan steps, execution state, and conversation thread ID
- **Checkpointing**: SQLite-based persistence for conversation state across email exchanges
- **Memory**: Conversation history with summarization for long-term memory

### Graph Flow
1. **Email Ingestion**: Parse incoming SES email
2. **Planning**: Use Claude Opus to create JSON plan of CMS API calls
3. **User Confirmation**: Interrupt for destructive operations or clarifications
4. **Execution**: Step-by-step tool execution with error handling
5. **Build & Notify**: Trigger preview builds and email results

### Tools
- **CMS Tools**: addPhoto, updatePage, deletePage, createPost, updatePost, listContent
- **Build Tool**: Netlify build hooks for preview/production
- **Email Tool**: AWS SES integration for replies
- **Human Tool**: Fallback for user input requests

### Human-in-the-Loop
- Agent uses `interrupt()` to pause execution
- State saved to SQLite checkpoint

## Routing Architecture (Task 05)

### Overview
The system uses intelligent routing to direct traffic between Fargate (live editing) and S3 (static production) based on active edit sessions. This enables cost-effective resource usage with instant preview capabilities during active editing.

### Path-Based Routing Strategy (MVP)
We use path-based routing with session IDs for simplicity and clarity:

#### Session Flow
1. **Email Request** → Hermes creates session in DynamoDB
2. **Fargate Startup** → Container scales from 0 when session created
3. **Preview URL** → `edit.ameliastamps.com/session/{sessionId}`
4. **Auto-shutdown** → After 5 minutes idle, Fargate scales to 0
5. **Static Fallback** → All non-session paths serve from S3

#### ALB Listener Rules
```
Priority 1: /api/* → Fargate API (port 8080)
Priority 2: /ws/* → Fargate WebSocket (HMR support)
Priority 3: /session/* → Fargate Astro dev (port 4321)
Default: /* → S3 static content (via CloudFront)
```

#### Why Path-Based Routing
- **Simpler**: No cookie/header management complexity
- **Shareable**: Users can share preview URLs directly
- **Clear semantics**: Session ID in URL makes state obvious
- **ALB native**: Direct path routing without Lambda validation
- **Future-proof**: Can migrate to Lambda@Edge for advanced routing in production

### Session Management
Sessions are tracked in DynamoDB with:
- Auto-scaling triggers based on active session count
- TTL for automatic cleanup after 30 minutes
- Status tracking (initializing → active → expired)
- Fargate task association for routing

### Cost Optimization
- **Scale to Zero**: No cost when not editing
- **5-minute idle timeout**: Aggressive shutdown for cost savings
- **Path-based routing**: Avoids Lambda@Edge costs for MVP
- **Fargate Spot**: Consider for additional 70% savings

### Future Production Enhancement
For production scale, we could implement Lambda@Edge for:
- Cookie-based session tracking
- Geographic routing optimization
- A/B testing capabilities
- Advanced caching strategies

However, the path-based ALB routing is simpler and sufficient for MVP with single-client alpha testing.

## Hermes Fargate Service

### Deployment Architecture
Hermes now runs as a cost-effective, scale-to-zero Fargate service:

- **Service Name**: `webordinary-hermes-service` 
- **API Endpoint**: `https://webordinary-edit-alb-916355172.us-west-2.elb.amazonaws.com/hermes`
- **Container Registry**: `942734823970.dkr.ecr.us-west-2.amazonaws.com/webordinary/hermes`
- **Routing**: ALB listener rule `/hermes/*` → Hermes API (Priority 5)

### Development Workflow
```bash
# Scale up for development/testing
aws ecs update-service --cluster webordinary-edit-cluster --service webordinary-hermes-service --desired-count 1 --profile personal

# Scale down to save costs ($0/month when idle)
aws ecs update-service --cluster webordinary-edit-cluster --service webordinary-hermes-service --desired-count 0 --profile personal

# Build and deploy container updates
cd hermes && ./build-and-push.sh
```

### Session Management Integration
Hermes manages the complete edit session lifecycle:
- **Session Creation**: Creates DynamoDB sessions via `/hermes/api/sessions/activate`
- **Fargate Control**: Scales edit containers from 0→1 via ECS API
- **Email Processing**: Handles SQS messages from SES for user instructions
- **Metrics Publishing**: Reports active sessions to CloudWatch for auto-scaling

### Cost Model
- **Development**: $0/month idle, ~$12-15/month active (0.5 vCPU, 1GB RAM)
- **Production Ready**: Can be always-on or auto-scale based on email volume
- **Transition Path**: Manual scaling during alpha, automatic scaling for beta/production

## 💰 Cost Summary

### Current Monthly Costs (All Infrastructure)
- **ECR**: ~$1/month (10 images)
- **Secrets Manager**: $0.40/month
- **EFS**: ~$5.25/month (10GB active + 90GB IA)
- **ALB**: $18-20/month (shared resource)
- **Lambda**: ~$0.10/month (build function)
- **CloudFront**: ~$1-5/month (varies with traffic)
- **Route53**: $0.50/month (hosted zone)
- **Fargate (when active)**: ~$0.10/hour
- **Total Idle**: ~$26-30/month
- **Total Active (10hrs)**: ~$27-31/month

## 🚀 Quick Start Commands

### Deploy Infrastructure
```bash
cd hephaestus
npm run build
npx cdk deploy --all --profile personal
```

### Test Production Site
```bash
curl https://amelia.webordinary.com
```

### Start Editor Session
```bash
# Scale up Fargate
aws ecs update-service \
  --cluster webordinary-edit-cluster \
  --service webordinary-edit-service \
  --desired-count 1 \
  --profile personal

# Access editor
open https://edit.amelia.webordinary.com
```

### Monitor Deployments
```bash
# Watch Lambda logs
aws logs tail /aws/lambda/HephaestusBuildFunction --follow --profile personal

# Check CloudFront status
aws cloudfront get-distribution --id E3FW6R4G95TKO2 --profile personal
```

## 📋 Completed Sprints

### Sprint 1 (Complete)
- ✅ Task 00: ECR, Secrets, EFS, ALB infrastructure
- ✅ Task 01: Claude Code Docker container
- ✅ Task 02: Fargate CDK extension
- ✅ Task 03: Bedrock integration (replaced LangGraph)
- ✅ Task 04: Git operations enhancement
- ✅ Task 05: Edit mode tracking and routing

### Sprint 3 (In Progress)
- ✅ Task 08: Amelia Astro dual deployment (production + editor)

## 🔮 Future Enhancements
- Multi-tenant support with isolated workspaces
- Staging environments for preview deployments
- CloudWatch dashboards and alerting
- Automated backup and disaster recovery
- Rate limiting and DDoS protection
- User authentication for editor access