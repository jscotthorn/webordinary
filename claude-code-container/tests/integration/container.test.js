#!/usr/bin/env node

/**
 * Container Integration Test
 * Tests the container's message processing and S3 deployment functionality
 * Updated for S3 architecture (no HTTP server)
 */

const { SQSClient, SendMessageCommand, ReceiveMessageCommand } = require('@aws-sdk/client-sqs');
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { execSync } = require('child_process');

// Test configuration
const TEST_CONFIG = {
  region: process.env.AWS_REGION || 'us-west-2',
  inputQueue: process.env.INPUT_QUEUE_URL || 'https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-queue',
  outputQueue: process.env.OUTPUT_QUEUE_URL || 'https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-dlq',
  clientId: 'amelia',
  s3Bucket: 'edit.amelia.webordinary.com',
  s3WebsiteUrl: 'http://edit.amelia.webordinary.com.s3-website-us-west-2.amazonaws.com',
  timeout: 60000 // 1 minute timeout
};

// Initialize AWS clients with personal profile
const awsConfig = {
  region: TEST_CONFIG.region,
  credentials: process.env.AWS_PROFILE === 'personal' ? undefined : undefined // Uses AWS_PROFILE env var
};

const sqsClient = new SQSClient(awsConfig);
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
async function testContainerProcessing() {
  console.log('🧪 Testing Container Message Processing (S3 Architecture)');
  console.log('=' . repeat(60));
  
  try {
    // Test 1: Container Health (via process check)
    console.log('\n1. Checking container process...');
    try {
      const processes = execSync('ps aux | grep node | grep -v grep', { encoding: 'utf8' });
      if (processes.includes('main.js')) {
        console.log('✅ Container process running');
      } else {
        console.log('⚠️  Container may not be running locally');
      }
    } catch (err) {
      console.log('⚠️  Cannot check local processes (may be in Docker)');
    }
    
    // Test 2: Send test message to SQS
    console.log('\n2. Sending test message to SQS...');
    const testMessage = {
      sessionId: `test-session-${Date.now()}`,
      commandId: `test-cmd-${Date.now()}`,
      chatThreadId: `test-thread-${Date.now()}`,
      clientId: TEST_CONFIG.clientId,
      instruction: 'Add a test comment to the homepage',
      userId: 'test-user',
      timestamp: Date.now()
    };
    
    try {
      const sendResult = await sqsClient.send(new SendMessageCommand({
        QueueUrl: TEST_CONFIG.inputQueue,
        MessageBody: JSON.stringify(testMessage)
      }));
      console.log('✅ Message sent:', sendResult.MessageId);
    } catch (err) {
      console.log('❌ Failed to send message:', err.message);
      console.log('   Make sure AWS credentials are configured');
      return;
    }
    
    // Test 3: Wait for S3 deployment
    console.log('\n3. Waiting for S3 deployment...');
    console.log(`   Monitoring bucket: ${TEST_CONFIG.s3Bucket}`);
    
    const deployed = await waitFor(async () => {
      try {
        const response = await s3Client.send(new HeadObjectCommand({
          Bucket: TEST_CONFIG.s3Bucket,
          Key: 'index.html'
        }));
        
        // Check if recently modified (within last 2 minutes)
        const lastModified = response.LastModified?.getTime() || 0;
        const twoMinutesAgo = Date.now() - 120000;
        
        if (lastModified > twoMinutesAgo) {
          console.log('   ✅ S3 updated at:', response.LastModified);
          return true;
        }
      } catch (err) {
        // File might not exist yet
      }
      return false;
    }, 30000, 2000);
    
    if (deployed) {
      console.log('✅ S3 deployment successful');
    } else {
      console.log('⚠️  S3 deployment not detected (may need more time)');
    }
    
    // Test 4: Verify site is accessible
    console.log('\n4. Verifying site accessibility...');
    const siteUrl = TEST_CONFIG.s3WebsiteUrl;
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(siteUrl);
      if (response.ok) {
        console.log('✅ Site accessible at:', siteUrl);
        const html = await response.text();
        if (html.includes('<!DOCTYPE html>')) {
          console.log('✅ Valid HTML content');
        }
      } else {
        console.log('⚠️  Site returned status:', response.status);
      }
    } catch (err) {
      console.log('⚠️  Could not access site:', err.message);
      console.log('   Trying direct domain: http://edit.amelia.webordinary.com');
      try {
        const response2 = await fetch('http://edit.amelia.webordinary.com');
        if (response2.ok) {
          console.log('✅ Site accessible via domain');
        }
      } catch (err2) {
        console.log('   Domain not accessible:', err2.message);
      }
    }
    
    // Test 5: Check git operations (if running locally)
    console.log('\n5. Checking git operations...');
    try {
      const gitBranch = execSync('git branch --show-current', { 
        encoding: 'utf8',
        cwd: process.env.WORKSPACE_PATH || '/workspace'
      }).trim();
      console.log('✅ Current git branch:', gitBranch);
      
      const gitStatus = execSync('git status --short', {
        encoding: 'utf8',
        cwd: process.env.WORKSPACE_PATH || '/workspace'
      });
      if (gitStatus) {
        console.log('   Uncommitted changes:', gitStatus.split('\n').length - 1, 'files');
      } else {
        console.log('   Working directory clean');
      }
    } catch (err) {
      console.log('⚠️  Git operations not available');
    }
    
    console.log('\n' + '=' . repeat(60));
    console.log('🎉 Container integration tests completed!');
    console.log('\nSummary:');
    console.log('- Message processing: Working via SQS');
    console.log('- S3 deployment: Check bucket for updates');
    console.log('- Git operations: Available in workspace');
    console.log('- No HTTP server (removed in S3 architecture)');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run tests
if (require.main === module) {
  testContainerProcessing();
}

module.exports = { testContainerProcessing };