# Sprint 3 Day 8-9: CDK Infrastructure Complete

## Date: 2025-08-17

## Summary
Successfully created all CDK infrastructure for the Step Functions refactor. All Lambda functions, DynamoDB tables, and the Step Functions state machine are now defined in CDK and ready for deployment to AWS.

## CDK Stacks Created/Modified

### 1. LambdaStack (NEW) ✅
**Location**: `/hephaestus/lib/lambda-stack.ts`
- **intake-lambda**: S3 event trigger to Step Functions
- **check-active-job-lambda**: DynamoDB active job checking
- **rate-limited-claim-lambda**: Conditional job claiming with TTL
- **send-interrupt-lambda**: Interrupt message dispatch
- **record-interruption-lambda**: Audit trail recording
- **handle-timeout-lambda**: Timeout cleanup and DLQ
- **process-attachment-lambda**: Docker image for Sharp processing

#### Key Features:
- ARM64 architecture for cost efficiency
- Proper IAM permissions for each Lambda
- Reserved concurrent executions for intake Lambda
- Docker image for attachment processing with Sharp
- Exported ARNs for cross-stack references
- Dead Letter Queue for intake Lambda failures

### 2. StepFunctionsStack (UPDATED) ✅
**Location**: `/hephaestus/lib/stepfunctions-stack.ts`
- Reads ASL definition from file
- Creates IAM role with proper permissions
- Enables X-Ray tracing
- CloudWatch Logs integration
- Exports state machine ARN

#### Permissions Granted:
- Lambda invocations for all functions
- SQS operations for queues
- DynamoDB operations for tables

### 3. SqsStack (UPDATED) ✅
**Location**: `/hephaestus/lib/sqs-stack.ts`

#### New Resources Added:
- **SES Email Bucket**: 30-day lifecycle for raw emails
- **Active Jobs Table**: TTL-enabled for job tracking
- **Interruptions Table**: Audit trail with GSI for queries

#### Configuration:
- S3 bucket with encryption and public access blocked
- DynamoDB tables with PAY_PER_REQUEST billing
- TTL attributes for automatic cleanup
- Global Secondary Indexes for efficient queries

### 4. CDK App (UPDATED) ✅
**Location**: `/hephaestus/bin/hephaestus.ts`
- Added LambdaStack and StepFunctionsStack
- Commented out deprecated HermesStack
- Updated dependencies between stacks
- Fixed monitoring stack dependencies

## ASL Definition Updates

### Lambda Function Names Fixed
All Lambda function references in the ASL updated to match CDK naming:
- `check-active-job-lambda` → `webordinary-check-active-job-lambda`
- `send-interrupt-lambda` → `webordinary-send-interrupt-lambda`
- `record-interruption-lambda` → `webordinary-record-interruption-lambda`
- `rate-limited-claim-lambda` → `webordinary-rate-limited-claim-lambda`
- `process-attachment-lambda` → `webordinary-process-attachment-lambda`
- `handle-timeout-lambda` → `webordinary-handle-timeout-lambda`

## Files Created/Modified

### Created
- `/hephaestus/lib/lambda-stack.ts` - Complete Lambda infrastructure

### Modified
- `/hephaestus/lib/stepfunctions-stack.ts` - Updated Lambda function names
- `/hephaestus/lib/stepfunctions/email-processor.asl.json` - Fixed function names
- `/hephaestus/lib/sqs-stack.ts` - Added SES bucket and new tables
- `/hephaestus/bin/hephaestus.ts` - Integrated new stacks
- `/hephaestus/lib/lambda-stack.ts` - Fixed asset paths (../lambdas instead of ../../lambdas)
- `/docs/REFACTOR_STATUS.md` - Updated progress

## Infrastructure Architecture

### Resource Naming Convention
All resources follow the pattern: `webordinary-{resource-type}-{specific-name}`
- Lambda: `webordinary-{function}-lambda`
- Tables: `webordinary-{table-name}`
- Buckets: `webordinary-ses-emails`
- State Machine: `email-processor`

### Cost Optimization
- ARM64 architecture for Lambda (20% cheaper)
- PAY_PER_REQUEST for DynamoDB (no idle costs)
- TTL for automatic data cleanup
- S3 lifecycle rules for email deletion

### Security
- Least privilege IAM policies
- S3 bucket encryption
- Public access blocked on all buckets
- Separate roles for each component

## Testing Completed ✅

### CDK Synthesis Validation
Successfully synthesized all stacks after fixing Lambda asset paths:
```bash
npx cdk synth SqsStack       # ✅ Success
npx cdk synth LambdaStack    # ✅ Success (after path fixes)
npx cdk synth StepFunctionsStack  # ✅ Success
```

### Local Testing with LocalStack
Tested complete email processing flow:
```bash
./scripts/test-email.sh  # Creates test email and uploads to S3
```

#### Test Results:
1. **S3 Upload**: ✅ Email successfully uploaded to bucket
2. **Lambda Invocation**: ✅ intake-lambda triggered by S3 event  
3. **Step Functions**: ✅ Execution started successfully
4. **DynamoDB Operations**: ✅ Active jobs table working
5. **State Transitions**: ✅ CheckActiveJob → IsJobActive → SendInterrupt flow working
6. **Interrupt Detection**: ✅ System correctly detects existing active job

#### Verification Commands:
```bash
# Check Step Functions executions
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  aws --endpoint-url=http://localhost:4566 \
  stepfunctions list-executions \
  --state-machine-arn arn:aws:states:us-east-1:000000000000:stateMachine:email-processor

# Check active jobs table
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  aws --endpoint-url=http://localhost:4566 \
  dynamodb scan --table-name webordinary-active-jobs
```

### Deployment Order
1. SqsStack (provides tables and bucket)
2. LambdaStack (provides functions)
3. StepFunctionsStack (orchestrates everything)

## Key Design Decisions

### Stack Dependencies
```
SqsStack (base resources)
    ↓
LambdaStack (functions need tables)
    ↓
StepFunctionsStack (needs Lambda ARNs)
    ↓
MonitoringStack (monitors everything)
```

### Lambda Configuration
- **Reserved Concurrency**: Only for intake Lambda (prevents throttling)
- **Memory**: 128MB for control functions, 1024MB for processing
- **Timeout**: 10s for control, 60s for processing
- **Architecture**: ARM64 for all (cost savings)

### DynamoDB Design
- **Active Jobs**: Single table, projectUserId as key
- **Interruptions**: Audit trail with TTL
- **No Scan Operations**: All queries use keys or GSIs

## Next Steps (Sprint 3 Day 10-11)

### Deploy to AWS
1. Build all Lambda functions
2. Deploy SqsStack first
3. Deploy LambdaStack
4. Deploy StepFunctionsStack
5. Configure S3 event notifications
6. Update SES receipt rules

### Testing
1. Send test email through SES
2. Verify Step Functions execution
3. Check Lambda logs
4. Validate DynamoDB writes

## Lessons Learned

### CDK Best Practices
- Export critical ARNs for cross-stack references
- Use stack dependencies to ensure correct deployment order
- Keep Lambda function names consistent across CDK and ASL
- Use environment variables for dynamic configuration

### Infrastructure as Code
- All resources defined in TypeScript
- Version controlled with Git
- Reproducible deployments
- Easy rollback if needed

## Success Metrics

### Achieved
- ✅ All 7 Lambda functions defined in CDK
- ✅ Step Functions state machine configured
- ✅ DynamoDB tables with proper indexes
- ✅ S3 bucket with lifecycle rules
- ✅ IAM policies with least privilege
- ✅ Cross-stack references working
- ✅ ASL definition validated

### Ready for Deployment
- Infrastructure fully defined
- Dependencies properly configured
- Security policies in place
- Monitoring hooks available

## Conclusion

Sprint 3 Day 8-9 successfully delivered the complete CDK infrastructure for the Step Functions refactor. All Lambda functions, DynamoDB tables, S3 buckets, and the Step Functions state machine are now defined and ready for deployment. The infrastructure follows AWS best practices for security, cost optimization, and maintainability. The next step is to deploy these stacks to AWS and begin integration testing with real emails.