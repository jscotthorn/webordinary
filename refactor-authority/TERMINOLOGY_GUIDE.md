# WebOrdinary Terminology Guide

## Core Entities

### Client
- **Definition**: Account holder organization (future concept)
- **Current Status**: Not implemented, reserved for future
- **Example**: "Amelia Stamps Inc" (future)
- **Relationships**: Has many projects
- **Note**: Often confused with "project" - avoid using this term for now

### Project
- **Definition**: A specific website or application
- **Current Example**: "amelia" (Astro pottery site)
- **Identifier**: Project name (lowercase, no spaces)
- **Storage**: Git repository
- **S3 Bucket**: `edit.{project}.webordinary.com`
- **Relationships**: Belongs to client (future), worked on by users

### User
- **Definition**: Person working on projects
- **Identifier**: Email address
- **Current Example**: `escottster@gmail.com`
- **Relationships**: Can work on multiple projects across clients
- **Authentication**: Via email (future: OAuth)

### Session
- **Definition**: Communication thread
- **Current Implementation**: Email thread
- **Future**: Chat thread, SMS conversation
- **Identifier**: `chatThreadId` extracted via:
  - Pattern match: `thread-([a-zA-Z0-9-]+)@` in headers
  - Headers checked: In-Reply-To, References
  - Fallback: Hash of Message-ID for new threads
  - **Issue**: Email clients don't reliably preserve custom headers
  - **TODO**: Need to embed in email body/template as fallback
- **Git Branch**: `thread-{chatThreadId}`
- **Persistence**: Continues across multiple messages
- **Note**: NOT the same as container ownership

## Architectural Concepts

### Project+User
- **Definition**: Container ownership model
- **Example**: `amelia+escottster@gmail.com`
- **Purpose**: One container handles all sessions for this combination
- **Claim**: Container claims this combination from unclaimed queue

### Unclaimed Queue
- **Definition**: Queue containing work without active processor
- **Contents**: Project+user combinations needing containers
- **Purpose**: Warm containers monitor this for new work

### Input Queue
- **Definition**: Project+user specific message queue
- **Naming**: `webordinary-input-{projectId}-{userId-hash}`
- **Purpose**: Direct messages to claimed container

### Output Queue
- **Definition**: Response queue from container
- **Naming**: `webordinary-output-{projectId}-{userId-hash}`
- **Purpose**: Container sends results back to Hermes

## Message Types

### WorkMessage
- **From**: Hermes
- **To**: Container (via input queue)
- **Contains**: instruction, repoUrl, session info
- **Purpose**: Tell container what to do

### ClaimRequest
- **From**: Hermes
- **To**: Unclaimed queue
- **Contains**: Project+user to claim
- **Purpose**: Signal available work

### ResponseMessage
- **From**: Container
- **To**: Hermes (via output queue)
- **Contains**: Results, errors, build status
- **Purpose**: Report work completion

## Git Conventions

### Branch Naming
- **Pattern**: `thread-{chatThreadId}`
- **Example**: `thread-abc123def456`
- **Purpose**: One branch per email thread
- **Lifecycle**: Persists across session

### Commit Messages
- **Format**: `[instruction summary] via WebOrdinary`
- **Example**: `Update homepage title via WebOrdinary`
- **Includes**: User context, timestamp

## AWS Resources

### Queues
- **Production**:
  - `webordinary-email-queue` - Incoming emails from SES
  - `webordinary-unclaimed-queue` - Available work
  - `webordinary-email-dlq` - Failed messages
  
- **Development** (proposed):
  - `webordinary-email-queue-dev`
  - `webordinary-unclaimed-queue-dev`
  - `webordinary-email-dlq-dev`

### DynamoDB Tables
- `webordinary-thread-mappings` - Email thread to session mapping
- `webordinary-containers` - Container claim tracking
- `webordinary-edit-sessions` - Active session state
- `webordinary-queue-tracking` - Queue lifecycle management

### S3 Buckets
- **Pattern**: `edit.{project}.webordinary.com`
- **Current**: `edit.amelia.webordinary.com`
- **Purpose**: Static site hosting
- **Deployment**: After each build

## Common Confusions to Avoid

### ❌ Wrong Terminology
- "Session container" - Containers are per project+user
- "Client site" - Use "project" instead
- "User session" - Be specific: "email thread" or "project+user claim"
- "Container per session" - It's per project+user

### ✅ Correct Terminology
- "Project+user container" or "claimed container"
- "Project website" or just "project"
- "Email thread" or "chat thread" (future)
- "Container handles project+user combination"

## Environment Variables

### Naming Conventions
- `PROJECT_ID` not `CLIENT_ID` (though current code may use CLIENT_ID)
- `USER_EMAIL` not `USER_ID` (when referring to email)
- `CHAT_THREAD_ID` not `SESSION_ID` (for git branches)
- `UNCLAIMED_QUEUE_URL` not `AVAILABLE_QUEUE_URL`

## Code Comments

### Good Examples
```typescript
// Check if this project+user has an active claim
// Process work message for amelia+escottster@gmail.com
// Switch to thread-abc123 branch for this email thread
```

### Bad Examples
```typescript
// Check if session has container (ambiguous)
// Process client request (client vs project?)
// Handle user session (session means what?)
```

## Documentation Standards

When writing documentation:
1. Always use "project" not "client" for current implementation
2. Specify "email thread" not just "session"
3. Use "project+user" for container ownership
4. Include examples with real values (amelia, escottster@gmail.com)
5. Clarify future vs current features

## Migration Checklist

When updating code/docs:
- [ ] Replace "client" with "project" where appropriate
- [ ] Clarify "session" usage (thread vs ownership)
- [ ] Update variable names to match terminology
- [ ] Add comments explaining the model
- [ ] Update error messages for clarity