# Task 06: Integration Test Infrastructure

## Overview
Set up the foundational infrastructure for comprehensive integration testing of the complete email-to-preview workflow, including test harness, AWS service clients, and test data management.

## Scope
Build the testing framework and utilities needed to support end-to-end integration testing across all AWS services and container orchestration components.

## Implementation Plan

### Day 1: Test Harness Foundation
- **Integration Test Harness Setup**
  - Create TypeScript test harness with AWS SDK clients
  - Implement session lifecycle management utilities  
  - Add container readiness checking with retry logic
  - Create EFS workspace verification helpers

- **Test Configuration System**
  - Set up environment-specific configuration
  - Add AWS credential and profile management
  - Configure test timeouts and service endpoints
  - Create test client ID and workspace isolation

### Day 2: AWS Service Integration
- **Service Client Wrappers**
  - ECS client for service scaling and task management
  - DynamoDB client for session state verification
  - ALB client for health checking and routing
  - CloudWatch client for metrics validation

- **Test Data Management**
  - Implement test session creation and cleanup
  - Add EFS workspace setup and teardown
  - Create test repository with sample Astro content
  - Build isolated test environment controls

## Key Components

### IntegrationTestHarness Class
```typescript
export class IntegrationTestHarness {
  constructor(
    private readonly ecsClient: ECSClient,
    private readonly dynamoClient: DynamoDBClient,
    private readonly albEndpoint: string
  ) {}
  
  async createTestSession(params: CreateSessionParams): Promise<TestSession>
  async waitForContainerReady(sessionId: string, timeoutMs = 60000): Promise<void>
  async verifyFileExists(filePath: string): Promise<void>
  async cleanup(): Promise<void>
}
```

### Test Configuration
- AWS service endpoints and credentials
- Test-specific timeouts and retry policies
- Isolated workspace and data management
- Cost tracking and resource cleanup

## Success Criteria
- ✅ Test harness can create and manage test sessions
- ✅ AWS service clients work with proper error handling
- ✅ Container readiness detection works reliably
- ✅ Test data isolation and cleanup functions properly
- ✅ Configuration supports multiple test environments

## Timeline: 2 days
## Dependencies: Tasks 00-05 deployed and functional
## Cost: ~$5-10 for development and testing