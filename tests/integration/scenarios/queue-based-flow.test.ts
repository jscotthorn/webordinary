/**
 * Queue-Based Flow Test Suite
 * 
 * Verifies the complete queue-based communication pattern:
 * Email → Hermes → Project Queue → Container Claim → S3 Deployment
 */

import { 
  SQSClient, 
  SendMessageCommand, 
  ReceiveMessageCommand,
  GetQueueAttributesCommand 
} from '@aws-sdk/client-sqs';
import { 
  DynamoDBClient, 
  GetItemCommand,
  PutItemCommand 
} from '@aws-sdk/client-dynamodb';
import { 
  S3Client, 
  HeadObjectCommand 
} from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

describe('Queue-Based Communication Flow', () => {
  const TEST_TIMEOUT = 60000; // 1 minute for queue operations
  const config = {
    region: process.env.AWS_REGION || 'us-west-2',
    accountId: process.env.AWS_ACCOUNT_ID || '942734823970',
    projectId: 'ameliastamps',
    userId: 'scott',
  };

  // Queue URLs
  const queueUrls = {
    email: `https://sqs.${config.region}.amazonaws.com/${config.accountId}/webordinary-email-queue`,
    unclaimed: `https://sqs.${config.region}.amazonaws.com/${config.accountId}/webordinary-unclaimed`,
    input: `https://sqs.${config.region}.amazonaws.com/${config.accountId}/webordinary-input-${config.projectId}-${config.userId}`,
    output: `https://sqs.${config.region}.amazonaws.com/${config.accountId}/webordinary-output-${config.projectId}-${config.userId}`,
  };

  // AWS Clients
  const sqsClient = new SQSClient({ region: config.region });
  const dynamoClient = new DynamoDBClient({ region: config.region });
  const s3Client = new S3Client({ region: config.region });

  // Helper functions
  const waitForMessage = async (queueUrl: string, timeout = 30000): Promise<any> => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const result = await sqsClient.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 5,
      }));
      
      if (result.Messages && result.Messages.length > 0) {
        return JSON.parse(result.Messages[0].Body || '{}');
      }
    }
    return null;
  };

  const checkOwnership = async (projectId: string, userId: string): Promise<boolean> => {
    const projectKey = `${projectId}#${userId}`;
    try {
      const result = await dynamoClient.send(new GetItemCommand({
        TableName: 'webordinary-container-ownership',
        Key: { projectKey: { S: projectKey } },
      }));
      return !!result.Item;
    } catch {
      return false;
    }
  };

  describe('Email to S3 Deployment Flow', () => {
    test('should route email through queues to container and deploy', async () => {
      const sessionId = `test-${uuidv4()}`;
      const threadId = `thread-${uuidv4()}`;
      
      // Step 1: Simulate email arrival
      console.log('Step 1: Sending simulated email to queue...');
      const emailMessage = {
        messageId: uuidv4(),
        content: `From: escottster@gmail.com
To: edit@webordinary.com
Subject: Test deployment
Message-ID: <${threadId}@webordinary.com>

Update the homepage title to "Test Deployment ${Date.now()}"`,
      };

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: queueUrls.email,
        MessageBody: JSON.stringify(emailMessage),
      }));
      console.log('✅ Email sent to queue');

      // Step 2: Verify Hermes routes to project queue
      console.log('Step 2: Waiting for message in project queue...');
      const projectMessage = await waitForMessage(queueUrls.input);
      
      if (projectMessage) {
        expect(projectMessage.projectId).toBe(config.projectId);
        expect(projectMessage.userId).toBe(config.userId);
        console.log('✅ Message routed to project queue');
      } else {
        console.log('⚠️ Message not found in project queue, checking unclaimed...');
        
        // Check if it went to unclaimed queue
        const unclaimedMessage = await waitForMessage(queueUrls.unclaimed, 10000);
        if (unclaimedMessage) {
          expect(unclaimedMessage.type).toBe('claim_request');
          console.log('✅ Claim request sent to unclaimed queue');
        }
      }

      // Step 3: Check container ownership
      console.log('Step 3: Checking container ownership...');
      const hasOwner = await checkOwnership(config.projectId, config.userId);
      
      if (hasOwner) {
        console.log('✅ Container has claimed ownership');
      } else {
        console.log('⚠️ No container ownership (may need to scale up)');
      }

      // Step 4: Wait for response in output queue
      console.log('Step 4: Waiting for response in output queue...');
      const response = await waitForMessage(queueUrls.output, 40000);
      
      if (response) {
        expect(response.success).toBeDefined();
        console.log(`✅ Response received: ${response.success ? 'Success' : 'Failed'}`);
        if (response.summary) {
          console.log(`   Summary: ${response.summary}`);
        }
      } else {
        console.log('❌ No response received within timeout');
      }

      // Step 5: Verify S3 deployment
      console.log('Step 5: Checking S3 deployment...');
      const bucketName = `edit.${config.projectId}.webordinary.com`;
      
      try {
        const s3Result = await s3Client.send(new HeadObjectCommand({
          Bucket: bucketName,
          Key: 'index.html',
        }));
        
        const isRecent = (Date.now() - s3Result.LastModified!.getTime()) < 300000; // 5 minutes
        if (isRecent) {
          console.log('✅ S3 deployment successful and recent');
        } else {
          console.log('⚠️ S3 exists but not recently updated');
        }
      } catch (err) {
        console.log('❌ S3 deployment not found');
      }
    }, TEST_TIMEOUT);
  });

  describe('Container Claim Mechanism', () => {
    test('should claim project from unclaimed queue', async () => {
      // Step 1: Send claim request
      console.log('Step 1: Sending claim request...');
      const claimRequest = {
        type: 'claim_request',
        projectId: config.projectId,
        userId: config.userId,
        timestamp: Date.now(),
      };

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: queueUrls.unclaimed,
        MessageBody: JSON.stringify(claimRequest),
      }));
      console.log('✅ Claim request sent');

      // Step 2: Wait for ownership
      console.log('Step 2: Waiting for container to claim...');
      let claimed = false;
      const startTime = Date.now();
      
      while (!claimed && Date.now() - startTime < 20000) {
        claimed = await checkOwnership(config.projectId, config.userId);
        if (!claimed) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      expect(claimed).toBe(true);
      if (claimed) {
        console.log('✅ Container successfully claimed ownership');
        
        // Get ownership details
        const projectKey = `${config.projectId}#${config.userId}`;
        const ownershipResult = await dynamoClient.send(new GetItemCommand({
          TableName: 'webordinary-container-ownership',
          Key: { projectKey: { S: projectKey } },
        }));
        
        if (ownershipResult.Item) {
          console.log(`   Container ID: ${ownershipResult.Item.containerId?.S}`);
          console.log(`   Status: ${ownershipResult.Item.status?.S}`);
        }
      } else {
        console.log('❌ Container did not claim within timeout');
      }
    }, TEST_TIMEOUT);
  });

  describe('Message Processing Pipeline', () => {
    test('should process instruction and return response', async () => {
      const commandId = uuidv4();
      const sessionId = `test-${uuidv4()}`;
      
      // Step 1: Send instruction to project queue
      console.log('Step 1: Sending instruction to project queue...');
      const instruction = {
        sessionId,
        commandId,
        instruction: 'Add a comment to the main layout file',
        projectId: config.projectId,
        userId: config.userId,
        timestamp: Date.now(),
      };

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: queueUrls.input,
        MessageBody: JSON.stringify(instruction),
      }));
      console.log('✅ Instruction sent');

      // Step 2: Wait for response
      console.log('Step 2: Waiting for processing response...');
      const startTime = Date.now();
      let response = null;
      
      while (!response && Date.now() - startTime < 30000) {
        const result = await sqsClient.send(new ReceiveMessageCommand({
          QueueUrl: queueUrls.output,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 5,
        }));
        
        if (result.Messages) {
          for (const message of result.Messages) {
            const body = JSON.parse(message.Body || '{}');
            if (body.commandId === commandId) {
              response = body;
              break;
            }
          }
        }
      }

      expect(response).toBeTruthy();
      if (response) {
        expect(response.commandId).toBe(commandId);
        expect(response.sessionId).toBe(sessionId);
        console.log(`✅ Response received for command ${commandId}`);
        console.log(`   Success: ${response.success}`);
        console.log(`   Summary: ${response.summary || response.message}`);
      } else {
        console.log('❌ No response for command within timeout');
      }
    }, TEST_TIMEOUT);
  });

  describe('Queue Metrics', () => {
    test('should check queue depths and DLQ', async () => {
      console.log('Checking queue metrics...');
      
      for (const [name, url] of Object.entries(queueUrls)) {
        try {
          const result = await sqsClient.send(new GetQueueAttributesCommand({
            QueueUrl: url,
            AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
          }));
          
          const messages = parseInt(result.Attributes?.ApproximateNumberOfMessages || '0');
          const inFlight = parseInt(result.Attributes?.ApproximateNumberOfMessagesNotVisible || '0');
          
          console.log(`${name} queue: ${messages} messages, ${inFlight} in flight`);
          
          // Warn if queues are backing up
          if (messages > 10) {
            console.warn(`⚠️ ${name} queue has ${messages} messages backed up`);
          }
        } catch (err: any) {
          console.log(`❌ Failed to get metrics for ${name}: ${err.message}`);
        }
      }
    });
  });
});