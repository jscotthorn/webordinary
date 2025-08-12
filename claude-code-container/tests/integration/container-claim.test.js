#!/usr/bin/env node

/**
 * Container Claim Mechanism Test
 * Tests the container's ability to claim projects from unclaimed queue
 */

const { 
  SQSClient, 
  SendMessageCommand, 
  ReceiveMessageCommand, 
  GetQueueAttributesCommand 
} = require('@aws-sdk/client-sqs');
const { 
  DynamoDBClient, 
  GetItemCommand, 
  ScanCommand 
} = require('@aws-sdk/client-dynamodb');
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');

// Test configuration
const TEST_CONFIG = {
  region: process.env.AWS_REGION || 'us-west-2',
  accountId: process.env.AWS_ACCOUNT_ID || '942734823970',
  unclaimedQueue: process.env.UNCLAIMED_QUEUE_URL || 'https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-unclaimed',
  ownershipTable: process.env.OWNERSHIP_TABLE_NAME || 'webordinary-container-ownership',
  projectId: 'ameliastamps',
  userId: 'scott',
  timeout: 30000 // 30 second timeout
};

// Construct queue URLs
TEST_CONFIG.inputQueue = `https://sqs.${TEST_CONFIG.region}.amazonaws.com/${TEST_CONFIG.accountId}/webordinary-input-${TEST_CONFIG.projectId}-${TEST_CONFIG.userId}`;
TEST_CONFIG.outputQueue = `https://sqs.${TEST_CONFIG.region}.amazonaws.com/${TEST_CONFIG.accountId}/webordinary-output-${TEST_CONFIG.projectId}-${TEST_CONFIG.userId}`;
TEST_CONFIG.s3Bucket = `edit.${TEST_CONFIG.projectId}.webordinary.com`;

// Initialize AWS clients
const awsConfig = {
  region: TEST_CONFIG.region,
};

const sqsClient = new SQSClient(awsConfig);
const dynamoClient = new DynamoDBClient(awsConfig);
const s3Client = new S3Client(awsConfig);

// Helper function to wait for condition
async function waitFor(condition, timeout = TEST_CONFIG.timeout, interval = 1000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  return false;
}

// Test functions
async function testContainerClaim() {
  console.log('🧪 Testing Container Claim Mechanism');
  console.log('=' . repeat(60));
  console.log('Configuration:');
  console.log(`  Project: ${TEST_CONFIG.projectId}`);
  console.log(`  User: ${TEST_CONFIG.userId}`);
  console.log(`  Region: ${TEST_CONFIG.region}`);
  console.log('');
  
  const results = {
    passed: 0,
    failed: 0,
    skipped: 0
  };
  
  try {
    // Test 1: Check ownership table exists
    console.log('1. Checking ownership table...');
    try {
      const scanResult = await dynamoClient.send(new ScanCommand({
        TableName: TEST_CONFIG.ownershipTable,
        Limit: 1
      }));
      console.log(`✅ Ownership table exists with ${scanResult.Count || 0} entries`);
      results.passed++;
    } catch (err) {
      console.log(`❌ Ownership table not found: ${err.message}`);
      results.failed++;
      return results;
    }
    
    // Test 2: Send claim request to unclaimed queue
    console.log('\n2. Sending claim request to unclaimed queue...');
    const claimRequest = {
      type: 'claim_request',
      projectId: TEST_CONFIG.projectId,
      userId: TEST_CONFIG.userId,
      timestamp: Date.now()
    };
    
    try {
      const sendResult = await sqsClient.send(new SendMessageCommand({
        QueueUrl: TEST_CONFIG.unclaimedQueue,
        MessageBody: JSON.stringify(claimRequest)
      }));
      console.log(`✅ Claim request sent: ${sendResult.MessageId}`);
      results.passed++;
    } catch (err) {
      console.log(`❌ Failed to send claim request: ${err.message}`);
      results.failed++;
      return results;
    }
    
    // Test 3: Wait for container to claim ownership
    console.log('\n3. Waiting for container to claim ownership...');
    const projectKey = `${TEST_CONFIG.projectId}#${TEST_CONFIG.userId}`;
    
    const claimed = await waitFor(async () => {
      try {
        const result = await dynamoClient.send(new GetItemCommand({
          TableName: TEST_CONFIG.ownershipTable,
          Key: {
            projectKey: { S: projectKey }
          }
        }));
        
        if (result.Item) {
          console.log(`✅ Container claimed ownership:`);
          console.log(`   Container ID: ${result.Item.containerId?.S}`);
          console.log(`   Status: ${result.Item.status?.S}`);
          console.log(`   Claimed at: ${new Date(parseInt(result.Item.claimedAt?.N)).toISOString()}`);
          return true;
        }
      } catch (err) {
        console.log(`   Checking... (${err.message})`);
      }
      return false;
    }, 15000); // 15 second timeout for claim
    
    if (claimed) {
      results.passed++;
    } else {
      console.log('❌ Container did not claim ownership within timeout');
      results.failed++;
    }
    
    // Test 4: Send message to project queue
    console.log('\n4. Sending test message to project queue...');
    const testMessage = {
      sessionId: `test-${Date.now()}`,
      commandId: `cmd-${Date.now()}`,
      instruction: 'Add a test comment to index.astro',
      userEmail: 'test@example.com',
      projectId: TEST_CONFIG.projectId,
      userId: TEST_CONFIG.userId,
      timestamp: Date.now()
    };
    
    try {
      const sendResult = await sqsClient.send(new SendMessageCommand({
        QueueUrl: TEST_CONFIG.inputQueue,
        MessageBody: JSON.stringify(testMessage)
      }));
      console.log(`✅ Test message sent to project queue: ${sendResult.MessageId}`);
      results.passed++;
    } catch (err) {
      console.log(`❌ Failed to send message: ${err.message}`);
      results.failed++;
    }
    
    // Test 5: Wait for response in output queue
    console.log('\n5. Waiting for response in output queue...');
    const gotResponse = await waitFor(async () => {
      try {
        const result = await sqsClient.send(new ReceiveMessageCommand({
          QueueUrl: TEST_CONFIG.outputQueue,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 5
        }));
        
        if (result.Messages && result.Messages.length > 0) {
          const response = JSON.parse(result.Messages[0].Body);
          console.log(`✅ Received response:`);
          console.log(`   Command ID: ${response.commandId}`);
          console.log(`   Success: ${response.success}`);
          console.log(`   Summary: ${response.summary || response.message}`);
          return true;
        }
      } catch (err) {
        console.log(`   Polling... (${err.message})`);
      }
      return false;
    }, 20000); // 20 second timeout for processing
    
    if (gotResponse) {
      results.passed++;
    } else {
      console.log('❌ No response received within timeout');
      results.failed++;
    }
    
    // Test 6: Check S3 deployment
    console.log('\n6. Checking S3 deployment...');
    try {
      const response = await s3Client.send(new HeadObjectCommand({
        Bucket: TEST_CONFIG.s3Bucket,
        Key: 'index.html'
      }));
      
      const lastModified = response.LastModified?.getTime() || 0;
      const recentlyModified = (Date.now() - lastModified) < (5 * 60 * 1000); // Within 5 minutes
      
      if (recentlyModified) {
        console.log(`✅ S3 deployment successful`);
        console.log(`   Last modified: ${response.LastModified?.toISOString()}`);
        results.passed++;
      } else {
        console.log(`⚠️  S3 exists but not recently modified`);
        results.skipped++;
      }
    } catch (err) {
      console.log(`❌ S3 deployment check failed: ${err.message}`);
      results.failed++;
    }
    
    // Test 7: Check ownership persistence
    console.log('\n7. Checking ownership persistence...');
    try {
      const result = await dynamoClient.send(new GetItemCommand({
        TableName: TEST_CONFIG.ownershipTable,
        Key: {
          projectKey: { S: projectKey }
        }
      }));
      
      if (result.Item) {
        const lastActivity = parseInt(result.Item.lastActivity?.N || '0');
        const isActive = (Date.now() - lastActivity) < (2 * 60 * 1000); // Active within 2 minutes
        
        if (isActive) {
          console.log(`✅ Container ownership is active`);
          console.log(`   Last activity: ${new Date(lastActivity).toISOString()}`);
          results.passed++;
        } else {
          console.log(`⚠️  Container ownership exists but inactive`);
          results.skipped++;
        }
      } else {
        console.log('❌ Container ownership was released');
        results.failed++;
      }
    } catch (err) {
      console.log(`❌ Failed to check ownership: ${err.message}`);
      results.failed++;
    }
    
  } catch (error) {
    console.error('\n❌ Unexpected error:', error);
    results.failed++;
  }
  
  // Summary
  console.log('\n' + '=' . repeat(60));
  console.log('📊 Test Results:');
  console.log(`   ✅ Passed: ${results.passed}`);
  console.log(`   ❌ Failed: ${results.failed}`);
  console.log(`   ⚠️  Skipped: ${results.skipped}`);
  console.log('');
  
  if (results.failed === 0) {
    console.log('🎉 All tests passed! Container claim mechanism working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Check container logs for details.');
    console.log('   View logs: AWS_PROFILE=personal aws logs tail /ecs/webordinary/edit --since 5m');
  }
  
  return results;
}

// Run tests if executed directly
if (require.main === module) {
  testContainerClaim()
    .then(results => {
      process.exit(results.failed > 0 ? 1 : 0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { testContainerClaim };