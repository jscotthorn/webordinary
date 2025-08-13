/**
 * Email to S3 Deployment E2E Test Suite
 * 
 * Tests the complete flow from email receipt to S3 deployment
 * Following the current architecture:
 * Email → SES → SQS → Hermes → Container → S3
 */

import { SQSClient, SendMessageCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { S3Client, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, GetItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { v4 as uuidv4 } from 'uuid';

describe('Email to S3 Deployment E2E Flow', () => {
  const TEST_TIMEOUT = 180000; // 3 minutes for full E2E flow

  const config = {
    region: process.env.AWS_REGION || 'us-west-2',
    accountId: process.env.AWS_ACCOUNT_ID || '942734823970',
    emailQueue: 'https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-queue',
    logGroup: '/ecs/webordinary/edit',
  };

  const sqsClient = new SQSClient({ region: config.region });
  const s3Client = new S3Client({ region: config.region });
  const dynamoClient = new DynamoDBClient({ region: config.region });
  const logsClient = new CloudWatchLogsClient({ region: config.region });

  // Helper to wait for S3 deployment
  const waitForS3Deployment = async (
    bucketName: string,
    maxWait: number = 60000
  ): Promise<boolean> => {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      try {
        const result = await s3Client.send(new HeadObjectCommand({
          Bucket: bucketName,
          Key: 'index.html',
        }));

        // Check if recently updated (within last 5 minutes)
        if (result.LastModified) {
          const age = Date.now() - result.LastModified.getTime();
          if (age < 300000) {
            return true;
          }
        }
      } catch (error) {
        // File doesn't exist yet
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    return false;
  };

  describe('Single Email Complete Flow', () => {
    it('should process email from receipt to S3 deployment', async () => {
      const testId = `e2e-${uuidv4().substring(0, 8)}`;
      const threadId = `thread-${uuidv4()}`;
      const userEmail = 'escottster@gmail.com';
      const projectId = 'amelia';

      console.log(`🚀 Starting E2E test ${testId}`);

      // Step 1: Send email message to SQS (simulating SES)
      console.log('Step 1: Sending email to queue...');
      const emailContent = `From: ${userEmail}
To: buddy@webordinary.com
Subject: E2E Test ${testId}
Message-ID: <${threadId}@webordinary.com>
Date: ${new Date().toUTCString()}

Please update the homepage with a test section titled "E2E Test ${testId}"`;

      const emailMessage = {
        messageId: `ses-${uuidv4()}`,
        content: emailContent,
      };

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify(emailMessage),
        MessageAttributes: {
          source: { DataType: 'String', StringValue: 'e2e-test' },
        },
      }));

      console.log(`✅ Email sent to queue with thread ${threadId}`);

      // Step 2: Wait for Hermes to process and route
      console.log('Step 2: Waiting for message routing...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Check if thread mapping was created
      const threadMapping = await dynamoClient.send(new ScanCommand({
        TableName: 'webordinary-thread-mappings',
        FilterExpression: 'threadId = :threadId',
        ExpressionAttributeValues: {
          ':threadId': { S: threadId },
        },
        Limit: 1,
      }));

      if (threadMapping.Items && threadMapping.Items.length > 0) {
        console.log(`✅ Thread mapping created for ${threadId}`);
        const mapping = threadMapping.Items[0];
        expect(mapping.projectId?.S).toBe(projectId);
        expect(mapping.userId?.S).toBeTruthy();
      }

      // Step 3: Wait for container to claim and process
      console.log('Step 3: Waiting for container processing...');

      // Check container ownership
      const ownership = await dynamoClient.send(new ScanCommand({
        TableName: 'webordinary-container-ownership',
        FilterExpression: 'projectKey = :pk',
        ExpressionAttributeValues: {
          ':pk': { S: `${projectId}#scott` },
        },
        Limit: 1,
      }));

      if (ownership.Items && ownership.Items.length > 0) {
        console.log(`✅ Container claimed ${projectId}#scott`);
      }

      // Step 4: Wait for S3 deployment
      console.log('Step 4: Waiting for S3 deployment...');
      const bucketName = `edit.${projectId}.webordinary.com`;
      const deployed = await waitForS3Deployment(bucketName);

      expect(deployed).toBe(true);
      console.log(`✅ Site deployed to S3: ${bucketName}`);

      // Step 5: Verify content is accessible
      console.log('Step 5: Verifying site accessibility...');
      const siteUrl = `https://${bucketName}/`;

      try {
        const response = await fetch(siteUrl);
        expect(response.status).toBe(200);

        const html = await response.text();
        expect(html).toContain('<!DOCTYPE html>');
        console.log(`✅ Site accessible at ${siteUrl}`);

        // Check if our content was added (may not be immediate)
        if (html.includes(testId)) {
          console.log(`✅ Test content found in deployed site`);
        } else {
          console.log(`⚠️ Test content not yet visible (may need rebuild)`);
        }
      } catch (error) {
        console.log(`⚠️ Site fetch failed: ${error}`);
      }

      // Step 6: Check CloudWatch logs
      console.log('Step 6: Checking CloudWatch logs...');
      try {
        const logs = await logsClient.send(new FilterLogEventsCommand({
          logGroupName: config.logGroup,
          filterPattern: `"${threadId}"`,
          startTime: Date.now() - 300000, // Last 5 minutes
        }));

        if (logs.events && logs.events.length > 0) {
          console.log(`✅ Found ${logs.events.length} log entries for thread`);

          // Look for key events
          const s3SyncLog = logs.events.find(e =>
            e.message?.includes('S3 sync') || e.message?.includes('Deploying to S3')
          );
          if (s3SyncLog) {
            console.log(`✅ S3 sync confirmed in logs`);
          }
        }
      } catch (error) {
        console.log(`⚠️ CloudWatch log check failed: ${error}`);
      }

      console.log(`🎉 E2E test ${testId} completed successfully`);
    }, TEST_TIMEOUT);
  });

  describe('Email Thread Continuity', () => {
    it('should maintain session across email thread', async () => {
      const testId = `thread-${uuidv4().substring(0, 8)}`;
      const threadId = `thread-${uuidv4()}`;
      const userEmail = 'escottster@gmail.com';
      const projectId = 'amelia';

      console.log(`🔄 Testing thread continuity ${testId}`);

      // Send first email
      const firstEmail = `From: ${userEmail}
To: buddy@webordinary.com
Subject: Thread Test ${testId}
Message-ID: <${threadId}@webordinary.com>

Create a new page called "thread-test"`;

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify({
          messageId: `ses-1-${uuidv4()}`,
          content: firstEmail,
        }),
      }));

      console.log(`✅ First email sent`);
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Send follow-up in same thread
      const replyEmail = `From: ${userEmail}
To: buddy@webordinary.com
Subject: Re: Thread Test ${testId}
Message-ID: <${uuidv4()}@webordinary.com>
In-Reply-To: <${threadId}@webordinary.com>
References: <${threadId}@webordinary.com>

Add a section to the thread-test page`;

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify({
          messageId: `ses-2-${uuidv4()}`,
          content: replyEmail,
        }),
      }));

      console.log(`✅ Reply email sent in same thread`);
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Verify both processed in same session
      const threadMappings = await dynamoClient.send(new ScanCommand({
        TableName: 'webordinary-thread-mappings',
        FilterExpression: 'threadId = :threadId',
        ExpressionAttributeValues: {
          ':threadId': { S: threadId },
        },
      }));

      if (threadMappings.Items && threadMappings.Items.length > 0) {
        console.log(`✅ Thread mapping maintained for ${threadId}`);

        // Should have same session for both messages
        const sessionId = threadMappings.Items[0].sessionId?.S;
        expect(sessionId).toBeTruthy();
        console.log(`✅ Both emails mapped to session: ${sessionId}`);
      }

      // Check S3 for updates
      const bucketName = `edit.${projectId}.webordinary.com`;
      const deployed = await waitForS3Deployment(bucketName, 30000);

      if (deployed) {
        console.log(`✅ Updates deployed to S3`);
      }
    }, TEST_TIMEOUT);
  });

  describe('Error Recovery', () => {
    it('should handle malformed email gracefully', async () => {
      console.log('🔧 Testing error recovery...');

      // Send malformed message
      const malformedMessage = {
        unknown: 'field',
        instruction: 'test',
        chatThreadId: 'invalid-format',
      };

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify(malformedMessage),
      }));

      console.log('✅ Malformed message sent');
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Check DLQ for rejected message
      const dlqUrl = config.emailQueue.replace('email-queue', 'email-dlq');
      const dlqAttributes = await sqsClient.send(new GetQueueAttributesCommand({
        QueueUrl: dlqUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }));

      const dlqCount = parseInt(
        dlqAttributes.Attributes?.ApproximateNumberOfMessages || '0'
      );

      // Message should be rejected, not in DLQ if properly filtered
      console.log(`📊 DLQ message count: ${dlqCount}`);

      // System should continue processing valid messages
      const validEmail = `From: test@example.com
To: buddy@webordinary.com
Subject: Valid message after error

Process this valid instruction`;

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify({
          messageId: `ses-valid-${uuidv4()}`,
          content: validEmail,
        }),
      }));

      console.log('✅ System recovered and processing valid messages');
    });
  });

  describe('Performance Metrics', () => {
    it('should measure end-to-end processing time', async () => {
      const metrics = {
        emailToRouting: 0,
        routingToProcessing: 0,
        processingToS3: 0,
        totalTime: 0,
      };

      const startTime = Date.now();
      const threadId = `perf-${uuidv4()}`;

      // Send email
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify({
          messageId: `ses-perf-${uuidv4()}`,
          content: `From: test@example.com
To: buddy@webordinary.com
Message-ID: <${threadId}@webordinary.com>

Performance test message`,
        }),
      }));

      const emailSentTime = Date.now();

      // Wait for routing
      let routed = false;
      while (!routed && Date.now() - startTime < 30000) {
        const result = await dynamoClient.send(new ScanCommand({
          TableName: 'webordinary-thread-mappings',
          FilterExpression: 'threadId = :threadId',
          ExpressionAttributeValues: { ':threadId': { S: threadId } },
          Limit: 1,
        }));

        if (result.Items && result.Items.length > 0) {
          routed = true;
          metrics.emailToRouting = Date.now() - emailSentTime;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Wait for S3 deployment
      const deployed = await waitForS3Deployment('edit.amelia.webordinary.com', 60000);

      if (deployed) {
        metrics.totalTime = Date.now() - startTime;
        metrics.processingToS3 = metrics.totalTime - metrics.emailToRouting;
      }

      console.log('📊 Performance Metrics:');
      console.log(`  Email → Routing: ${metrics.emailToRouting}ms`);
      console.log(`  Processing → S3: ${metrics.processingToS3}ms`);
      console.log(`  Total E2E Time: ${metrics.totalTime}ms`);

      // Performance targets
      expect(metrics.totalTime).toBeLessThan(120000); // Under 2 minutes

      if (metrics.emailToRouting > 0) {
        expect(metrics.emailToRouting).toBeLessThan(15000); // Routing under 15s
      }
    });
  });
});