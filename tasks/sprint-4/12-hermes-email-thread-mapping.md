# Task 12: Hermes Chat Thread ID Extraction and Session Mapping

## Objective
Update Hermes to extract thread IDs from incoming messages (email for now) and map them to edit sessions consistently.

## Requirements

### Thread ID Extraction Strategy

1. **Email Sources (SES)**:
   - `Message-ID`: Unique identifier for this email
   - `In-Reply-To`: ID of email being replied to
   - `References`: Chain of message IDs in thread
   - `Thread-Index`: Microsoft Exchange thread identifier

2. **Session ID Format**:
   - Pattern: `{clientId}-{messageId}`
   - Example: `ameliastamps-a1b2c3d4`
   - Git branch: `thread-{messageId}`

## Implementation Steps

1. Update email parser to extract thread headers
2. Implement thread ID normalization function
3. Create DynamoDB table for thread mappings
4. Update session creation to use email thread IDs
5. Add thread context to Claude instructions

## Code Structure

```typescript
// hermes/src/modules/message-processor/thread-extractor.service.ts
export class ThreadExtractorService {
  extractThreadId(message: IncomingMessage): string {
    switch (message.source) {
      case 'email':
        return this.extractEmailThreadId(message.data as ParsedMail);
      case 'sms':
        return this.extractSmsThreadId(message.data as SmsMessage);
      case 'chat':
        return this.extractChatThreadId(message.data as ChatMessage);
      default:
        return this.generateNewThreadId();
    }
  }
  
  private extractEmailThreadId(email: ParsedMail): string {
    // Try References header first (most reliable)
    if (email.references) {
      const refs = Array.isArray(email.references) 
        ? email.references 
        : [email.references];
      return this.hashMessageId(refs[0]);
    }
    
    // Fall back to In-Reply-To
    if (email.inReplyTo) {
      return this.hashMessageId(email.inReplyTo);
    }
    
    // New thread - use current Message-ID
    return this.hashMessageId(email.messageId);
  }
  
  private hashMessageId(messageId: string): string {
    // Create short, URL-safe hash
    const hash = crypto.createHash('sha256')
      .update(messageId)
      .digest('base64url')
      .substring(0, 8);
    return hash;
  }
  
  async getOrCreateSession(
    clientId: string,
    chatThreadId: string,
    userId: string,
    source: 'email' | 'sms' | 'chat'
  ): Promise<EditSession> {
    const sessionId = `${clientId}-${chatThreadId}`;
    
    // Check for existing session
    const existing = await this.dynamoDB.getSession(sessionId);
    if (existing) {
      // Update last activity and source if different
      if (existing.lastSource !== source) {
        await this.dynamoDB.updateSessionSource(sessionId, source);
      }
      return existing;
    }
    
    // Create new session
    return this.editSessionService.createSession(
      clientId,
      userId,
      sessionId,
      `thread-${chatThreadId}`, // git branch
      source
    );
  }
}
```

## DynamoDB Schema

```typescript
interface ThreadMapping {
  messageId: string;      // PK (source-specific ID)
  threadId: string;       // Canonical thread ID
  sessionId: string;      // Full session ID
  clientId: string;       // GSI
  userId: string;         // User identifier (email, phone, etc)
  source: string;         // 'email' | 'sms' | 'chat'
  lastSource: string;     // Most recent message source
  firstSeen: string;      // ISO timestamp
  lastActivity: string;   // ISO timestamp
  messageCount: number;
  ttl: number;           // Unix timestamp for expiry
}
```

## Success Criteria
- [ ] Thread IDs correctly extracted from all sources (email, SMS, chat)
- [ ] Consistent session IDs across message thread
- [ ] Thread mappings stored in DynamoDB with source tracking
- [ ] Follow-up messages resume same session regardless of channel
- [ ] Git branches use generic thread naming
- [ ] Cross-channel continuity supported (start in email, continue in chat)

## Testing
- Test with various email clients (Gmail, Outlook, Apple Mail)
- Test SMS threading with Twilio
- Test chat session continuity
- Verify thread ID consistency across channels
- Test new threads vs replies
- Test thread ID collision handling
- Test channel switching within same thread