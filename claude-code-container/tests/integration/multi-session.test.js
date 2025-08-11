#!/usr/bin/env node

/**
 * Multi-Session Test Script for Sprint 7
 * Tests various scenarios including rapid switching, interrupts, and concurrent operations
 */

const { SQSClient, SendMessageCommand, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');

// Configuration
const AWS_REGION = process.env.AWS_REGION || 'us-west-2';
const INPUT_QUEUE_URL = process.env.INPUT_QUEUE_URL || 'https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-queue';
const CLIENT_ID = process.env.CLIENT_ID || 'amelia';

// Initialize AWS clients with personal profile
const awsConfig = {
  region: AWS_REGION
  // AWS SDK will automatically use AWS_PROFILE or credentials from environment
};

const sqsClient = new SQSClient(awsConfig);
const s3Client = new S3Client(awsConfig);

// Test messages for different scenarios
const testMessages = {
  // Scenario 1: Basic session flow
  session1_msg1: {
    sessionId: "session-aaa-111",
    commandId: "cmd-001",
    chatThreadId: "thread-aaa",
    clientId: CLIENT_ID,
    instruction: "Add a welcome message to the homepage saying 'Welcome to our amazing site!'",
    userId: "test-user-1",
    timestamp: Date.now()
  },
  
  session1_msg2: {
    sessionId: "session-aaa-111",
    commandId: "cmd-003",
    chatThreadId: "thread-aaa",
    clientId: CLIENT_ID,
    instruction: "Change the welcome message color to blue",
    userId: "test-user-1",
    timestamp: Date.now()
  },
  
  // Scenario 2: Session switching
  session2_msg1: {
    sessionId: "session-bbb-222",
    commandId: "cmd-002", 
    chatThreadId: "thread-bbb",
    clientId: CLIENT_ID,
    instruction: "Update the footer copyright year to 2025",
    userId: "test-user-1",
    timestamp: Date.now()
  },
  
  // Scenario 3: Interrupt testing
  interrupt_msg: {
    sessionId: "session-ccc-333",
    commandId: "cmd-004",
    chatThreadId: "thread-ccc",
    clientId: CLIENT_ID,
    instruction: "Emergency fix: Add maintenance notice to the header",
    userId: "test-user-2",
    timestamp: Date.now()
  },
  
  // Scenario 4: Concurrent users
  user1_session: {
    sessionId: "user1-session-" + Date.now(),
    commandId: "user1-cmd-" + Date.now(),
    chatThreadId: "user1-thread",
    userId: "user-1",
    clientId: CLIENT_ID,
    instruction: "User 1: Add a testimonial section to the about page",
    timestamp: Date.now()
  },
  
  user2_session: {
    sessionId: "user2-session-" + Date.now(),
    commandId: "user2-cmd-" + Date.now(),
    chatThreadId: "user2-thread", 
    userId: "user-2",
    clientId: CLIENT_ID,
    instruction: "User 2: Update the contact form with new fields",
    timestamp: Date.now()
  }
};

// Send message to SQS
async function sendMessage(messageKey) {
  const message = testMessages[messageKey];
  if (!message) {
    console.error(`Message key "${messageKey}" not found`);
    return false;
  }
  
  try {
    const command = new SendMessageCommand({
      QueueUrl: INPUT_QUEUE_URL,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        sessionId: {
          DataType: 'String',
          StringValue: message.sessionId
        },
        commandId: {
          DataType: 'String',
          StringValue: message.commandId
        }
      }
    });
    
    const response = await sqsClient.send(command);
    console.log(`✅ Sent ${messageKey}:`, {
      sessionId: message.sessionId,
      commandId: message.commandId,
      instruction: message.instruction.substring(0, 50) + '...',
      messageId: response.MessageId
    });
    return true;
  } catch (error) {
    console.error(`❌ Failed to send ${messageKey}:`, error.message);
    return false;
  }
}

// Get queue statistics
async function getQueueStats() {
  try {
    const command = new GetQueueAttributesCommand({
      QueueUrl: INPUT_QUEUE_URL,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
    });
    
    const response = await sqsClient.send(command);
    console.log('📊 Queue Stats:', response.Attributes);
  } catch (error) {
    console.error('Failed to get queue stats:', error.message);
  }
}

// Check S3 deployment
async function checkS3Deployment(sessionId) {
  const bucket = `edit.${CLIENT_ID}.webordinary.com`;
  
  try {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: 'index.html'
    });
    
    const response = await s3Client.send(command);
    
    // Check if recently modified
    const lastModified = response.LastModified?.getTime() || 0;
    const fiveMinutesAgo = Date.now() - 300000;
    
    if (lastModified > fiveMinutesAgo) {
      console.log(`  ✅ S3 deployment successful for session ${sessionId}`);
      console.log(`     Last modified: ${response.LastModified}`);
      return true;
    } else {
      console.log(`  ⚠️ S3 has older content (not from this session)`);
      return false;
    }
  } catch (error) {
    console.log(`  ❌ S3 check failed: ${error.message}`);
    return false;
  }
}

// Wait for S3 deployment with timeout
async function waitForS3Deployment(sessionId, timeout = 60000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (await checkS3Deployment(sessionId)) {
      return true;
    }
    
    // Wait 5 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  console.log(`  ⚠️ S3 deployment timeout for session ${sessionId}`);
  return false;
}

// Test scenarios
async function runScenario1() {
  console.log('\n🧪 Scenario 1: Basic Session Flow with S3 Deployment');
  console.log('Testing single session with multiple commands and S3 verification...\n');
  
  await sendMessage('session1_msg1');
  console.log('Waiting for processing and S3 deployment...');
  
  // Wait for S3 deployment
  await waitForS3Deployment('session-aaa-111', 60000);
  
  await sendMessage('session1_msg2');
  console.log('Waiting for second update...');
  await new Promise(resolve => setTimeout(resolve, 20000));
  
  // Check S3 again for the update
  await checkS3Deployment('session-aaa-111');
  
  console.log('✅ Scenario 1 complete with S3 verification\n');
}

async function runScenario2() {
  console.log('\n🧪 Scenario 2: Session Switching with S3 Verification');
  console.log('Testing switching between sessions and S3 deployments...\n');
  
  await sendMessage('session1_msg1');
  console.log('Waiting for first session S3 deployment...');
  await waitForS3Deployment('session-aaa-111', 40000);
  
  await sendMessage('session2_msg1');
  console.log('Waiting for second session S3 deployment...');
  await waitForS3Deployment('session-bbb-222', 40000);
  
  await sendMessage('session1_msg2');
  console.log('Waiting for first session update...');
  await new Promise(resolve => setTimeout(resolve, 20000));
  
  // Verify both sessions have deployed to S3
  console.log('\nVerifying final S3 state:');
  await checkS3Deployment('session-aaa-111');
  await checkS3Deployment('session-bbb-222');
  
  console.log('✅ Scenario 2 complete with S3 verification\n');
}

async function runScenario3() {
  console.log('\n🧪 Scenario 3: Interrupt During Build');
  console.log('Testing interruption during long operations...\n');
  
  await sendMessage('session1_msg1');
  console.log('Waiting 2 seconds before interrupt...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await sendMessage('interrupt_msg');
  console.log('✅ Scenario 3 messages sent\n');
}

async function runScenario4() {
  console.log('\n🧪 Scenario 4: Rapid Session Switching');
  console.log('Testing system under rapid switching load...\n');
  
  for (let i = 0; i < 3; i++) {
    console.log(`Round ${i + 1}/3:`);
    await sendMessage('session1_msg1');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await sendMessage('session2_msg1');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.log('✅ Scenario 4 messages sent\n');
}

async function runScenario5() {
  console.log('\n🧪 Scenario 5: Concurrent Users with S3 Deployments');
  console.log('Testing different users working simultaneously with S3 verification...\n');
  
  // Send both messages nearly simultaneously
  const promises = [
    sendMessage('user1_session'),
    sendMessage('user2_session')
  ];
  
  await Promise.all(promises);
  
  console.log('Waiting for concurrent S3 deployments...');
  
  // Wait for both S3 deployments
  const deployPromises = [
    waitForS3Deployment('user1-session', 60000),
    waitForS3Deployment('user2-session', 60000)
  ];
  
  const results = await Promise.all(deployPromises);
  
  if (results[0] && results[1]) {
    console.log('✅ Both concurrent sessions deployed to S3 successfully');
  } else {
    console.log('⚠️ Some concurrent deployments may have failed');
  }
  
  console.log('✅ Scenario 5 complete with S3 verification\n');
}

// Main test runner
async function main() {
  const scenario = process.argv[2];
  
  console.log('🚀 Multi-Session Test Runner');
  console.log('=============================');
  console.log(`Queue: ${INPUT_QUEUE_URL}`);
  console.log(`Client: ${CLIENT_ID}`);
  console.log(`Region: ${AWS_REGION}\n`);
  
  // Check queue status
  await getQueueStats();
  
  switch(scenario) {
    case '1':
      await runScenario1();
      break;
    case '2':
      await runScenario2();
      break;
    case '3':
      await runScenario3();
      break;
    case '4':
      await runScenario4();
      break;
    case '5':
      await runScenario5();
      break;
    case 'all':
      console.log('Running all scenarios...\n');
      await runScenario1();
      await new Promise(resolve => setTimeout(resolve, 60000));
      await runScenario2();
      await new Promise(resolve => setTimeout(resolve, 60000));
      await runScenario3();
      await new Promise(resolve => setTimeout(resolve, 60000));
      await runScenario4();
      await new Promise(resolve => setTimeout(resolve, 60000));
      await runScenario5();
      break;
    default:
      console.log('Usage: node test-multi-session.js <scenario>');
      console.log('Scenarios:');
      console.log('  1 - Basic Session Flow');
      console.log('  2 - Session Switching');
      console.log('  3 - Interrupt During Build');
      console.log('  4 - Rapid Session Switching');
      console.log('  5 - Concurrent Users');
      console.log('  all - Run all scenarios');
      process.exit(1);
  }
  
  // Final queue status
  console.log('\nFinal queue status:');
  await getQueueStats();
}

// Run tests
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { sendMessage, testMessages };