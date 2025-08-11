# Task 06: Test Container Locally

## Objective
Run the modified container locally to verify the complete workflow: SQS → Claude → Build → S3.

## Context
Before deploying to ECS, we need to ensure the container works correctly in a local Docker environment.

## Prerequisites
- Task 04 & 05 completed
- Docker installed locally
- AWS credentials configured
- S3 bucket accessible

## Setup

### 1. Build Container
```bash
cd /Users/scott/Projects/webordinary/claude-code-container

# Build with platform for consistency
docker build --platform linux/amd64 -t claude-s3-local .
```

### 2. Prepare Test Environment
```bash
# Create local workspace if needed
mkdir -p /tmp/workspace/amelia/stamps

# Clone or copy Astro project
cp -r /path/to/astro/project /tmp/workspace/amelia/stamps
```

### 3. Run Container
```bash
docker run -it \
  --platform linux/amd64 \
  -v /tmp/workspace:/workspace \
  -v ~/.aws:/root/.aws:ro \
  -e AWS_PROFILE=personal \
  -e AWS_REGION=us-west-2 \
  -e CLIENT_ID=amelia \
  -e PROJECT_ID=stamps \
  -e WORKSPACE_PATH=/workspace/amelia/stamps \
  -e INPUT_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/xxxxx/webordinary-input-amelia-stamps-scott \
  -e GITHUB_TOKEN=${GITHUB_TOKEN} \
  claude-s3-local
```

## Test Scenarios

### 1. Basic Message Processing
Send a test message via SQS:
```javascript
// send-test-message.js
const AWS = require('aws-sdk');
const sqs = new AWS.SQS({ region: 'us-west-2' });

const message = {
  clientId: 'amelia',
  projectId: 'stamps',
  threadId: 'test-thread-1',
  command: 'Add a test comment to the homepage'
};

const params = {
  QueueUrl: 'https://sqs.us-west-2.amazonaws.com/xxxxx/webordinary-input-amelia-stamps-scott',
  MessageBody: JSON.stringify(message)
};

sqs.sendMessage(params).promise()
  .then(data => console.log('Message sent:', data.MessageId))
  .catch(err => console.error('Error:', err));
```

### 2. Verify Container Processing
Watch container logs:
```bash
# In another terminal
docker logs -f [container-id]

# Should see:
# - Message received
# - Claude executing
# - Astro building
# - S3 syncing
# - Message deleted from queue
```

### 3. Check S3 Deployment
```bash
# Verify files uploaded
aws s3 ls s3://edit.amelia.webordinary.com/ --recursive | head -20

# Check site is updated
open http://edit.amelia.webordinary.com
```

### 4. Test Error Scenarios

#### Build Failure
```javascript
// Send message that will cause build failure
const message = {
  command: 'Delete the package.json file'  // Will break build
};
```

#### S3 Permission Denied
```bash
# Run container without AWS credentials
docker run -it \
  -v /tmp/workspace:/workspace \
  claude-s3-local
# Should handle gracefully
```

## Debugging

### Container Shell Access
```bash
# Run with shell for debugging
docker run -it --entrypoint /bin/sh \
  -v /tmp/workspace:/workspace \
  -v ~/.aws:/root/.aws:ro \
  -e AWS_PROFILE=personal \
  claude-s3-local

# Test commands manually
aws s3 ls
cd /workspace/amelia/stamps
npm run build
aws s3 sync ./dist s3://edit.amelia.webordinary.com --delete
```

### Check AWS Credentials
```bash
# Inside container
aws sts get-caller-identity
aws s3 ls s3://edit.amelia.webordinary.com/
```

## Acceptance Criteria
- [ ] Container builds successfully
- [ ] Container processes SQS messages
- [ ] Claude executes commands (if API key valid)
- [ ] Astro builds successfully
- [ ] S3 sync completes
- [ ] Site updates visible at edit.amelia.webordinary.com
- [ ] Errors handled gracefully

## Performance Checks
- [ ] Memory usage reasonable (<1GB)
- [ ] Build completes in reasonable time (<2 min)
- [ ] S3 sync completes quickly (<30 sec)

## Time Estimate
2-3 hours including debugging

## Notes
- Use small test commands initially
- Monitor CloudWatch logs if using real SQS
- Test with both new and existing projects
- Verify git operations still work if implemented