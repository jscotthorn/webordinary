# Thread ID Extraction Issue

## Problem Summary

The current implementation attempts to extract thread IDs from email headers, but email clients don't reliably preserve custom headers when users reply. This causes thread continuity to break.

## Current Implementation

### How It Works Now (hermes/src/modules/email-processor/email-processor.service.ts)

1. **Extraction Attempt** (lines 141-155):
```typescript
private extractThreadId(parsed: any): string | undefined {
  // Try to extract from In-Reply-To or References headers
  if (parsed.inReplyTo) {
    const match = parsed.inReplyTo.match(/thread-([a-zA-Z0-9-]+)@/);
    if (match) return match[1];
  }
  
  if (parsed.references && Array.isArray(parsed.references)) {
    for (const ref of parsed.references) {
      const match = ref.match(/thread-([a-zA-Z0-9-]+)@/);
      if (match) return match[1];
    }
  }
  
  return undefined;
}
```

2. **Acknowledgment Email** (lines 236-248):
Sets custom headers including `Thread-Id` attribute:
```typescript
MessageAttributes: {
  'Thread-Id': {
    DataType: 'String',
    StringValue: threadId,
  },
}
```

### The Problem

- **Custom Headers Lost**: Email clients (Gmail, Outlook, etc.) don't preserve custom headers when replying
- **Pattern Matching Fails**: Looking for `thread-xxx@` pattern in headers that don't exist
- **Thread Continuity Breaks**: New thread created instead of continuing existing one
- **Session Fragmentation**: User's work gets split across multiple sessions

## Proposed Solution

### Option 1: Embed Thread ID in Email Body (Recommended)

Add thread ID to the email template in a way that survives replies:

```typescript
private async sendAcknowledgmentEmail(
  email: any,
  projectId: string,
  needsUnclaimed: boolean,
): Promise<void> {
  const threadId = email.threadId || generateThreadId();
  
  let body = 'Your request has been received...\n\n';
  
  // Add thread ID in footer that will be included in replies
  body += '\n---\n';
  body += `Thread ID: ${threadId}\n`;
  body += `Do not remove this line - it helps track your conversation\n`;
  
  // Also try to set Message-ID with thread pattern
  const messageId = `<thread-${threadId}@webordinary.com>`;
  
  // ... rest of email sending
}
```

Then extract from body if headers fail:

```typescript
private extractThreadId(parsed: any): string | undefined {
  // Try headers first (existing code)
  const headerThreadId = this.extractFromHeaders(parsed);
  if (headerThreadId) return headerThreadId;
  
  // Fallback to body extraction
  const bodyText = parsed.text || '';
  const bodyMatch = bodyText.match(/Thread ID:\s*([a-zA-Z0-9-]+)/);
  if (bodyMatch) return bodyMatch[1];
  
  // Generate new if nothing found
  return this.generateNewThreadId();
}
```

### Option 2: Use Message-ID Format

Set the Message-ID header in a specific format that email clients preserve:

```typescript
// In sendAcknowledgmentEmail
const messageId = `<thread-${threadId}@webordinary.com>`;

const params = {
  // ... other params
  Message: {
    // ... subject and body
  },
  // Use Source instead of MessageAttributes for headers
  RawMessage: {
    Data: buildRawEmailWithHeaders(messageId, threadId, ...),
  },
};
```

### Option 3: Database Lookup by Email Metadata

Track thread continuity using other reliable fields:

```typescript
async findExistingThread(email: ParsedEmail): Promise<string | null> {
  // Look up by combination of:
  // - User email (from)
  // - Subject line similarity
  // - Recent time window
  
  const recentThreads = await this.dynamodb.query({
    IndexName: 'user-email-index',
    KeyConditionExpression: 'userEmail = :email',
    FilterExpression: 'createdAt > :cutoff',
    ExpressionAttributeValues: {
      ':email': email.from,
      ':cutoff': Date.now() - (24 * 60 * 60 * 1000), // 24 hours
    },
  });
  
  // Find best matching thread by subject similarity
  return findBestMatch(recentThreads, email.subject);
}
```

## Implementation Priority

1. **Immediate Fix**: Add body-based thread ID extraction
2. **Short Term**: Implement Message-ID format properly
3. **Long Term**: Database lookup for thread continuity

## Testing Required

1. **Gmail Reply Test**: Send email, reply from Gmail, verify thread preserved
2. **Outlook Reply Test**: Same with Outlook
3. **Mobile Client Test**: Test with mobile email clients
4. **Forward Test**: Ensure forwarded emails don't break threading

## Files to Update

1. `hermes/src/modules/email-processor/email-processor.service.ts`
   - Update `extractThreadId` method
   - Update `sendAcknowledgmentEmail` method

2. `hermes/src/modules/message-processor/thread-extractor.service.ts`
   - Update `extractEmailThreadId` method
   - Add body extraction logic

3. Add tests for new extraction logic

## Success Criteria

- [ ] Thread ID survives email replies from major clients
- [ ] Existing sessions continue when user replies
- [ ] Git branches remain consistent across email thread
- [ ] No duplicate sessions for same conversation
- [ ] Clear thread ID visible to users (for support)

## Current Workaround

Users experiencing broken threads can:
1. Include original thread ID in email body manually
2. Reference the git branch name in their message
3. Use the web interface (future) instead of email