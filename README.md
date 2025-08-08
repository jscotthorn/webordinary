## Architecture Overview

### AWS Integration
Both applications integrate with AWS services:
- **Bedrock**: AI model inference (Hermes)
- **SQS**: Message queuing for asynchronous processing
- **S3**: Static asset deployment (Hephaestus)
- **CloudFront**: CDN invalidation (Hephaestus)
- **SES**: Email service integration (Hermes)

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

- Email sent with questions/confirmation request
- Resume on reply using conversation thread ID