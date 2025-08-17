# Hermes Service Final Configuration
**Archived**: 2025-08-17  
**Status**: Scaled to 0, scheduled for deletion

## Service Configuration
- **Cluster**: webordinary-edit-cluster
- **Service Name**: webordinary-hermes-service
- **Task Definition**: HermesStackHermesTaskDef89087CE3:5
- **Desired Count**: 0
- **Running Count**: 0
- **Status**: ACTIVE (but scaled to zero)

## CloudFormation Stack
- **Stack Name**: HermesStack
- **Status**: CREATE_COMPLETE
- **Region**: us-west-2

## SQS Queue Configuration
- **Queue Name**: webordinary-email-queue
- **URL**: https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-queue
- **Messages**: 0 (empty at deletion)
- **Created**: 2025-01-09 (timestamp: 1754830515)
- **DLQ**: webordinary-email-dlq (max receive count: 3)

## Container Image
- **Repository**: webordinary/hermes
- **Platform**: linux/amd64
- **Last Build Command**: `docker build --platform linux/amd64 -t webordinary/hermes .`

## Key Functions (Being Replaced)
1. **Email Processing**: Consumed messages from SES via SQS
2. **Message Routing**: Routed to project+user specific queues
3. **Container Management**: Managed container lifecycle and ownership
4. **Session Management**: Maintained thread-to-session mappings in DynamoDB

## DynamoDB Tables Used
- webordinary-thread-mappings
- webordinary-container-ownership
- webordinary-queue-tracking

## Environment Variables
- SQS queue URLs
- DynamoDB table names
- AWS region configuration

## Replacement
All functionality being replaced by:
- AWS Step Functions for orchestration
- Lambda functions for processing
- Direct S3 storage for emails
- Interrupt queues for preemption

---
*This configuration is archived for reference during the Step Functions migration.*