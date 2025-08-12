# Bedrock Integration Guide for WebOrdinary Local Development

## Overview
This guide covers the integration of Amazon Bedrock with the WebOrdinary platform for local development, enabling the use of Claude models through AWS's managed service.

## ✅ Task 1 Completion Summary

### What Was Implemented
1. **Reference IAM Policy** - Created policy template with access to Claude Sonnet 4, Haiku, and Opus models
2. **Environment Configuration** - Updated both container .env.local.example files with Bedrock settings
3. **Verification Script** - Enhanced existing verification script with Bedrock checks
4. **Health Check Enhancement** - Added Bedrock-aware health check script
5. **Documentation** - Comprehensive guide for Bedrock integration

### Files Created/Modified
- `/tasks/sprint-9/bedrock-iam-policy.json` - Reference IAM policy for Bedrock access
- `/claude-code-container/.env.local.example` - Added Bedrock configuration
- `/claude-code-container/scripts/verify-bedrock.sh` - Comprehensive verification script
- `/claude-code-container/scripts/health-check-bedrock.sh` - Enhanced health check
- `/hermes/.env.local.example` - Added Bedrock model configuration

---

## 🚀 Quick Start

### Prerequisites
1. AWS Account with Bedrock access enabled
2. AWS CLI installed and configured (`aws configure --profile personal`)
3. Docker installed for local container development

### Setup Steps

#### 1. Verify Bedrock Access
```bash
cd claude-code-container
./scripts/verify-bedrock.sh
```

This will:
- Verify AWS credentials
- Check existing Bedrock permissions
- Test model invocation capability
- Report on Claude Code SDK configuration
- Provide recommendations for setup

**Note**: This script only verifies access - it does NOT modify IAM policies. If you need permissions, refer to the IAM policy at `/tasks/sprint-9/bedrock-iam-policy.json`

#### 2. Configure Environment Files

**Claude Container** (`/claude-code-container/.env.local`):
```bash
# Bedrock Configuration
CLAUDE_CODE_USE_BEDROCK=1
AWS_REGION=us-west-2
CLAUDE_CODE_MAX_OUTPUT_TOKENS=4096
MAX_THINKING_TOKENS=1024

# Also ensure these are set:
AWS_PROFILE=personal
AWS_ACCOUNT_ID=942734823970
GITHUB_TOKEN=your_github_token_here  # Required for Git operations
```

**Hermes** (`/hermes/.env.local`):
```bash
# Bedrock Configuration
CLAUDE_CODE_USE_BEDROCK=1
BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-20250514-v1:0
BEDROCK_MODEL_ID_FAST=anthropic.claude-3-5-haiku-20241022-v1:0
AWS_REGION=us-west-2
AWS_PROFILE=personal
```

#### 3. Verify Bedrock Access
```bash
cd claude-code-container
./scripts/verify-bedrock.sh
```

Expected output:
```
✓ AWS credentials valid
✓ Bedrock access confirmed (31 Claude models available)
✓ Bedrock is accessible and ready for use
```

#### 4. Start Local Development
```bash
# Terminal 1 - Start Hermes
cd hermes
./scripts/start-local.sh

# Terminal 2 - Start Claude Container
cd claude-code-container
./scripts/start-local.sh
```

---

## 🔧 Configuration Details

### Models Available

| Model | ID | Use Case |
|-------|-----|----------|
| **Claude Sonnet 4** | `anthropic.claude-sonnet-4-20250514-v1:0` | Primary model - latest and most capable |
| **Claude 3.5 Haiku** | `anthropic.claude-3-5-haiku-20241022-v1:0` | Fast responses, lower cost |
| **Claude Opus 4.1** | `anthropic.claude-opus-4-1-20250805-v1:0` | Most powerful, higher cost |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAUDE_CODE_USE_BEDROCK` | Yes | Set to `1` to enable Bedrock |
| `AWS_REGION` | Yes | Must be `us-west-2` for our setup |
| `AWS_PROFILE` | Yes | AWS profile name (usually `personal`) |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | No | Max tokens for response (default: 4096) |
| `MAX_THINKING_TOKENS` | No | Max tokens for reasoning (default: 1024) |
| `BEDROCK_MODEL_ID` | No | Override default model selection |

### IAM Permissions Required

The minimum IAM permissions needed:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:ListFoundationModels",
        "bedrock:GetFoundationModel"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## 🧪 Testing Bedrock Integration

### Manual Test
```bash
# Test model listing
aws bedrock list-foundation-models \
  --region us-west-2 \
  --profile personal \
  --query 'modelSummaries[?contains(modelId, `claude`)].[modelId]' \
  --output table

# Test model invocation
echo '{"anthropic_version":"bedrock-2023-05-31","max_tokens":100,"messages":[{"role":"user","content":"Say hello"}]}' > test.json

aws bedrock-runtime invoke-model \
  --model-id anthropic.claude-3-5-haiku-20241022-v1:0 \
  --region us-west-2 \
  --profile personal \
  --content-type application/json \
  --body file://test.json \
  response.json
```

### Container Health Check
```bash
# Run enhanced health check
docker run --rm \
  -v ~/.aws:/home/appuser/.aws:ro \
  -e AWS_PROFILE=personal \
  -e AWS_REGION=us-west-2 \
  -e CLAUDE_CODE_USE_BEDROCK=1 \
  webordinary/claude-code-astro \
  /app/scripts/health-check-bedrock.sh
```

---

## 🐛 Troubleshooting

### Common Issues

#### 1. "Cannot access Bedrock models"
**Solution**: 
- Ensure Bedrock is enabled in your AWS account
- Request model access at: https://console.aws.amazon.com/bedrock/home#/modelaccess
- Wait for approval (usually instant for Claude models)

#### 2. "Model invocation failed"
**Solution**:
- Check IAM permissions include `bedrock:InvokeModel`
- Verify the model ID is correct and available in your region
- Ensure you have quota/credits for Bedrock usage

#### 3. "AWS credentials not configured"
**Solution**:
```bash
aws configure --profile personal
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key
# Default region: us-west-2
# Default output format: json
```

#### 4. "CLAUDE_CODE_USE_BEDROCK not set"
**Solution**:
- Add to your `.env.local` file
- Or export directly: `export CLAUDE_CODE_USE_BEDROCK=1`

---

## 💰 Cost Considerations

### Estimated Costs (per 1M tokens)
- **Claude Sonnet 4**: ~$3 input / $15 output
- **Claude 3.5 Haiku**: ~$0.25 input / $1.25 output  
- **Claude Opus 4.1**: ~$15 input / $75 output

### Cost Optimization Tips
1. Use Haiku for development/testing
2. Switch to Sonnet 4 for production workloads
3. Implement token limits in environment variables
4. Monitor usage via AWS Cost Explorer

---

## 🔐 Security Best Practices

1. **Never commit credentials**
   - Keep `.env.local` in `.gitignore`
   - Use AWS profiles instead of access keys

2. **Rotate credentials regularly**
   ```bash
   aws iam create-access-key --profile personal
   aws configure --profile personal
   ```

3. **Use least privilege**
   - Only grant access to specific models needed
   - Restrict to specific regions

4. **Monitor usage**
   ```bash
   aws bedrock get-model-invocation-logging-configuration \
     --region us-west-2 --profile personal
   ```

---

## 📚 Additional Resources

- [Claude Code Bedrock Documentation](https://docs.anthropic.com/en/docs/claude-code/amazon-bedrock)
- [AWS Bedrock Pricing](https://aws.amazon.com/bedrock/pricing/)
- [Bedrock Model Access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)
- [Claude Model Comparison](https://www.anthropic.com/claude)

---

## ✅ Task 1 Deliverables

1. ✅ **IAM Policy Configuration** - Complete
2. ✅ **Environment Updates** - Complete  
3. ✅ **Verification Scripts** - Complete
4. ✅ **Health Check Integration** - Complete
5. ✅ **Documentation** - Complete

**Status**: Task 1 is COMPLETE and ready for testing

---

## 📝 Next Steps (Tasks 2-5)

With Bedrock integration complete, the next sprint tasks are:
- **Task 2**: Docker Compose setup for both services
- **Task 3**: Local queue configuration
- **Task 4**: Unified startup scripts
- **Task 5**: Comprehensive testing and documentation

The foundation is now in place for full local development with real Claude models via Bedrock!