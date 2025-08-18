# Step Functions Flow Correction - Completion Entry 15

## Date: 2025-08-17

## Summary
Corrected the Step Functions flow order to match the proposal exactly, fixing both the execution sequence and error handling paths. The flow now properly checks ownership first, processes attachments second, checks active jobs third, and then routes to containers.

## Key Issues Fixed

### 1. Incorrect Flow Order ✅
**Previous (Wrong)**:
- ParseEmail → CheckActiveJob → ClaimJob → CheckIfClaimed → ProcessAttachments → SendToContainer

**Corrected (Per Proposal)**:
- ParseEmail → CheckOwnership → CheckAttachments → ProcessAttachments → CheckActiveJob → DetermineRouting → SendToContainer

### 2. Missing Routing Path ✅
**Issue**: When a container owned the project+user, messages weren't being sent to the project queue at all
**Fix**: Added proper routing logic where:
- If claimed: Goes directly to project+user FIFO queue
- If unclaimed: Goes to BOTH project+user FIFO queue AND unclaimed queue (parallel)

### 3. Error Handling Improvements ✅
- Fixed HandleContainerError to preserve required fields (region, accountId, projectId, userId)
- Fixed HandleTimeout to not reference non-existent containerId when unclaimed
- Fixed ASL validation errors (duplicate state names, invalid Choice syntax, improper End usage in Catch blocks)

## Flow Diagram Updates

Split the large Mermaid diagram into two readable diagrams:
1. **Email Intake Flow** - SES → S3 → Lambda → Step Functions
2. **Step Functions Processing Flow** - All the processing logic within Step Functions

## Technical Changes

### Files Modified
- `/hephaestus/lib/stepfunctions/email-processor.asl.json` - Complete rewrite to match proposal
- `/hephaestus/lambdas/rate-limited-claim-lambda/index.ts` - Changed from creating claims to checking ownership
- `/hephaestus/lib/lambda-stack.ts` - Updated environment variables for ownership checking
- `/refactor_authority/REFACTOR_PROPOSAL.md` - Split Mermaid diagrams for readability

### ASL Structure Changes
```json
// Proper flow with ownership check first
"StartAt": "ParseEmail",
"ParseEmail" → "CheckOwnership" → "CheckAttachments" → "CheckActiveJob" → "DetermineRouting"

// Fixed parallel routing for unclaimed
"SendToUnclaimedQueue": {
  "Type": "Parallel",
  "Branches": [
    // Branch 1: Send to project+user FIFO queue with task token
    // Branch 2: Send claim request to unclaimed queue
  ]
}
```

## Testing Results

### Success Metrics
1. ✅ Unclaimed queue pattern working correctly
2. ✅ Container receives claim requests and processes messages
3. ✅ Ownership check happens before attachment processing
4. ✅ Messages always go to project+user queue (plus unclaimed if not owned)
5. ✅ Error paths correctly route to DLQ with all required fields

### Evidence
```
Step Functions execution flow:
1. ParseEmail completed
2. CheckOwnership → claimed: false
3. CheckAttachments → no attachments
4. CheckActiveJob → no active job
5. DetermineRouting → SendToUnclaimedQueue
6. Parallel execution:
   - SendToContainerUnclaimed (FIFO queue)
   - SendClaimRequest (unclaimed queue)

Container logs:
[GenericContainerService] Received claim request for amelia/scott
[GenericContainerService] Successfully claimed amelia/scott
[GenericContainerService] Starting to poll project+user FIFO queue
[GenericContainerService] Received Step Functions message
```

## Design Clarifications

### Why Ownership Check First?
- Determines routing strategy early in the flow
- Avoids unnecessary attachment processing if routing is complex
- Matches the proposal's intended architecture

### Why Always Send to Project Queue?
- Ensures message is queued even if no container claims it immediately
- FIFO queue preserves order for that project+user
- Container that claims from unclaimed queue will find the message waiting

### Parallel Routing Pattern
- Uses Step Functions Parallel state for unclaimed routing
- Both branches execute simultaneously
- Project queue gets the actual message with task token
- Unclaimed queue gets a lightweight claim request

## Next Steps

1. Test with multiple project+user combinations simultaneously
2. Test interrupt handling with the new flow
3. Test attachment processing with the corrected order
4. Monitor container claiming patterns under load

## Lessons Learned

1. **Proposal Adherence**: Always verify implementation matches the proposal exactly
2. **State Machine Validation**: AWS Step Functions has strict ASL validation rules
3. **Error Path Completeness**: Error handlers must preserve all fields needed downstream
4. **Parallel State Limitations**: Catch blocks in parallel branches have different rules than main flow