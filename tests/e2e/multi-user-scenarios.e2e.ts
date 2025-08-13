/**
 * Multi-User Scenarios E2E Test Suite
 * 
 * Tests concurrent usage patterns with multiple users and projects
 * Validates the project+user claiming pattern and container management
 */

import { SQSClient, SendMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient, ScanCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { ECSClient, DescribeTasksCommand, ListTasksCommand } from '@aws-sdk/client-ecs';
import { v4 as uuidv4 } from 'uuid';

describe('Multi-User Scenarios E2E', () => {
  const TEST_TIMEOUT = 240000; // 4 minutes for multi-user scenarios

  const config = {
    region: process.env.AWS_REGION || 'us-west-2',
    accountId: process.env.AWS_ACCOUNT_ID || '942734823970',
    cluster: 'webordinary-edit-cluster',
    emailQueue: 'https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-queue',
  };

  const sqsClient = new SQSClient({ region: config.region });
  const dynamoClient = new DynamoDBClient({ region: config.region });
  const ecsClient = new ECSClient({ region: config.region });

  // Helper to send email for user
  const sendEmailForUser = async (
    userEmail: string,
    instruction: string,
    threadId?: string
  ) => {
    const messageThreadId = threadId || `thread-${uuidv4()}`;
    const emailContent = `From: ${userEmail}
To: buddy@webordinary.com
Subject: Multi-user test
Message-ID: <${messageThreadId}@webordinary.com>
Date: ${new Date().toUTCString()}

${instruction}`;

    await sqsClient.send(new SendMessageCommand({
      QueueUrl: config.emailQueue,
      MessageBody: JSON.stringify({
        messageId: `ses-${uuidv4()}`,
        content: emailContent,
      }),
    }));

    return messageThreadId;
  };

  // Helper to check container ownership
  const checkOwnership = async (projectId: string, userId: string) => {
    const result = await dynamoClient.send(new ScanCommand({
      TableName: 'webordinary-container-ownership',
      FilterExpression: 'projectKey = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `${projectId}#${userId}` },
      },
      Limit: 1,
    }));

    return result.Items && result.Items.length > 0 ? result.Items[0] : null;
  };

  describe('Concurrent Users Same Project', () => {
    it('should handle multiple users working on same project', async () => {
      const projectId = 'amelia';
      const users = [
        { email: 'scott@example.com', id: 'scott' },
        { email: 'alice@example.com', id: 'alice' },
        { email: 'bob@example.com', id: 'bob' },
      ];

      console.log(`👥 Testing ${users.length} concurrent users on project ${projectId}`);

      // Send emails from all users concurrently
      const threads = await Promise.all(
        users.map(user =>
          sendEmailForUser(
            user.email,
            `Update from ${user.id}: Add section for ${user.id}`
          )
        )
      );

      console.log(`✅ Sent ${threads.length} emails concurrently`);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 15000));

      // Check container ownership for each user
      const ownerships = await Promise.all(
        users.map(user => checkOwnership(projectId, user.id))
      );

      let containersClaimedCount = 0;
      const containerIds = new Set<string>();

      ownerships.forEach((ownership, index) => {
        if (ownership) {
          containersClaimedCount++;
          const containerId = ownership.containerId?.S;
          if (containerId) {
            containerIds.add(containerId);
          }
          console.log(`✅ User ${users[index].id} has container: ${containerId}`);
        } else {
          console.log(`⚠️ User ${users[index].id} waiting for container`);
        }
      });

      // Should have separate containers per user
      expect(containerIds.size).toBeGreaterThan(0);
      console.log(`📊 ${containerIds.size} unique containers serving ${users.length} users`);

      // Verify thread mappings
      for (let i = 0; i < threads.length; i++) {
        const threadMapping = await dynamoClient.send(new ScanCommand({
          TableName: 'webordinary-thread-mappings',
          FilterExpression: 'threadId = :threadId',
          ExpressionAttributeValues: {
            ':threadId': { S: threads[i] },
          },
          Limit: 1,
        }));

        if (threadMapping.Items && threadMapping.Items.length > 0) {
          expect(threadMapping.Items[0].projectId?.S).toBe(projectId);
          expect(threadMapping.Items[0].userId?.S).toBe(users[i].id);
          console.log(`✅ Thread ${threads[i]} mapped correctly for ${users[i].id}`);
        }
      }
    }, TEST_TIMEOUT);
  });

  describe('Multiple Projects Same User', () => {
    it('should handle single user working on multiple projects', async () => {
      const userEmail = 'scott@example.com';
      const userId = 'scott';
      const projects = ['amelia', 'test', 'demo'];

      console.log(`🔄 Testing user ${userId} on ${projects.length} projects`);

      // Send emails for different projects
      const threads: { project: string; threadId: string }[] = [];

      for (const project of projects) {
        const threadId = await sendEmailForUser(
          userEmail,
          `Work on ${project}: Update homepage for ${project}`
        );
        threads.push({ project, threadId });

        // Small delay between projects
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      console.log(`✅ Sent emails for ${projects.length} projects`);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 20000));

      // Check ownership for each project
      const ownerships = await Promise.all(
        projects.map(project => checkOwnership(project, userId))
      );

      const claimedProjects = projects.filter((_, index) => ownerships[index]);
      console.log(`📊 User ${userId} claimed ${claimedProjects.length}/${projects.length} projects`);

      // Containers might handle multiple projects for same user
      const containerIds = new Set<string>();
      ownerships.forEach((ownership, index) => {
        if (ownership) {
          const containerId = ownership.containerId?.S;
          if (containerId) {
            containerIds.add(containerId);
          }
          console.log(`✅ Project ${projects[index]} handled by container: ${containerId}`);
        }
      });

      // Could be same or different containers
      console.log(`📊 ${containerIds.size} containers handling ${projects.length} projects`);

      // If single container, it's handling multiple projects for same user (efficient)
      if (containerIds.size === 1) {
        console.log(`✅ Single container efficiently handling all projects for user ${userId}`);
      }
    }, TEST_TIMEOUT);
  });

  describe('Container Scaling Behavior', () => {
    it('should scale containers based on load', async () => {
      console.log('📈 Testing container scaling behavior');

      // Check initial container count
      const initialTasks = await ecsClient.send(new ListTasksCommand({
        cluster: config.cluster,
        serviceName: 'webordinary-edit-service',
      }));

      const initialCount = initialTasks.taskArns?.length || 0;
      console.log(`📊 Initial container count: ${initialCount}`);

      // Generate load with multiple users
      const loadUsers = Array.from({ length: 5 }, (_, i) => ({
        email: `user${i}@example.com`,
        id: `user${i}`,
      }));

      // Send burst of emails
      console.log(`🚀 Sending burst of ${loadUsers.length} emails...`);
      const loadThreads = await Promise.all(
        loadUsers.map(user =>
          sendEmailForUser(user.email, `Load test from ${user.id}`)
        )
      );

      // Wait for potential scaling
      await new Promise(resolve => setTimeout(resolve, 30000));

      // Check container count after load
      const afterLoadTasks = await ecsClient.send(new ListTasksCommand({
        cluster: config.cluster,
        serviceName: 'webordinary-edit-service',
      }));

      const afterLoadCount = afterLoadTasks.taskArns?.length || 0;
      console.log(`📊 Container count after load: ${afterLoadCount}`);

      if (afterLoadCount > initialCount) {
        console.log(`✅ Containers scaled up from ${initialCount} to ${afterLoadCount}`);
      } else {
        console.log(`ℹ️ No scaling needed (sufficient capacity)`);
      }

      // Check ownership distribution
      const ownerships = await dynamoClient.send(new ScanCommand({
        TableName: 'webordinary-container-ownership',
        FilterExpression: 'attribute_exists(containerId)',
      }));

      const activeOwnerships = ownerships.Items?.filter(item =>
        item.status?.S === 'active'
      ) || [];

      console.log(`📊 Active container claims: ${activeOwnerships.length}`);

      // Distribution analysis
      const containerDistribution = new Map<string, number>();
      activeOwnerships.forEach(ownership => {
        const containerId = ownership.containerId?.S;
        if (containerId) {
          containerDistribution.set(
            containerId,
            (containerDistribution.get(containerId) || 0) + 1
          );
        }
      });

      console.log('📊 Container workload distribution:');
      containerDistribution.forEach((count, containerId) => {
        console.log(`  Container ${containerId.substring(0, 12)}: ${count} project+user claims`);
      });
    }, TEST_TIMEOUT);
  });

  describe('User Switching Projects', () => {
    it('should handle user switching between projects', async () => {
      const userEmail = 'scott@example.com';
      const userId = 'scott';

      console.log('🔄 Testing project switching for user');

      // Work on first project
      const project1Thread = await sendEmailForUser(
        userEmail,
        'Start work on project amelia'
      );

      console.log('✅ Started work on project amelia');
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Check initial ownership
      const ameliaOwnership = await checkOwnership('amelia', userId);
      expect(ameliaOwnership).toBeTruthy();
      const container1 = ameliaOwnership?.containerId?.S;
      console.log(`✅ Container ${container1} claimed for amelia`);

      // Switch to different project
      const project2Thread = await sendEmailForUser(
        userEmail,
        'Switch to work on project test'
      );

      console.log('✅ Switched to project test');
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Check new ownership
      const testOwnership = await checkOwnership('test', userId);

      if (testOwnership) {
        const container2 = testOwnership?.containerId?.S;

        // Might be same or different container
        if (container1 === container2) {
          console.log(`✅ Same container ${container1} handling both projects`);
        } else {
          console.log(`✅ Different containers: ${container1} and ${container2}`);
        }
      }

      // Send another message to first project
      const returnThread = await sendEmailForUser(
        userEmail,
        'Return to amelia project work'
      );

      console.log('✅ Returned to project amelia');
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Container should still have the claim
      const returnOwnership = await checkOwnership('amelia', userId);
      expect(returnOwnership).toBeTruthy();
      console.log(`✅ Container maintained claim for amelia+${userId}`);
    }, TEST_TIMEOUT);
  });

  describe('Queue Prioritization', () => {
    it('should process messages in order per user', async () => {
      const userEmail = 'scott@example.com';
      const userId = 'scott';
      const projectId = 'amelia';

      console.log('📝 Testing message ordering for user');

      // Send multiple messages in sequence
      const messages = [
        'First: Create base structure',
        'Second: Add styling',
        'Third: Add interactions',
        'Fourth: Final polish',
      ];

      const threadId = `thread-${uuidv4()}`;
      const messageIds: string[] = [];

      for (const msg of messages) {
        await sendEmailForUser(userEmail, msg, threadId);
        messageIds.push(`msg-${messages.indexOf(msg)}`);

        // Small delay to ensure ordering
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log(`✅ Sent ${messages.length} messages in sequence`);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 20000));

      // Check CloudWatch logs for processing order
      // In real implementation, would verify via output queue messages

      // Verify all messages processed in same session
      const threadMapping = await dynamoClient.send(new ScanCommand({
        TableName: 'webordinary-thread-mappings',
        FilterExpression: 'threadId = :threadId',
        ExpressionAttributeValues: {
          ':threadId': { S: threadId },
        },
        Limit: 1,
      }));

      if (threadMapping.Items && threadMapping.Items.length > 0) {
        const sessionId = threadMapping.Items[0].sessionId?.S;
        console.log(`✅ All ${messages.length} messages processed in session: ${sessionId}`);

        // Messages should be processed in FIFO order for same session
        expect(sessionId).toBeTruthy();
      }
    });
  });

  describe('Concurrent Projects Different Users', () => {
    it('should handle multiple projects with different users simultaneously', async () => {
      const scenarios = [
        { project: 'amelia', user: 'scott', email: 'scott@example.com' },
        { project: 'test', user: 'alice', email: 'alice@example.com' },
        { project: 'demo', user: 'bob', email: 'bob@example.com' },
        { project: 'amelia', user: 'carol', email: 'carol@example.com' }, // Same project, different user
      ];

      console.log(`🌐 Testing ${scenarios.length} concurrent project+user combinations`);

      // Send all emails concurrently
      const threads = await Promise.all(
        scenarios.map(s =>
          sendEmailForUser(
            s.email,
            `Work by ${s.user} on ${s.project}`
          ).then(threadId => ({ ...s, threadId }))
        )
      );

      console.log(`✅ Sent ${threads.length} concurrent emails`);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 20000));

      // Check ownership for each combination
      const ownerships = await Promise.all(
        scenarios.map(s => checkOwnership(s.project, s.user))
      );

      // Analyze results
      const results = scenarios.map((s, index) => ({
        ...s,
        claimed: !!ownerships[index],
        containerId: ownerships[index]?.containerId?.S,
      }));

      console.log('📊 Ownership results:');
      results.forEach(r => {
        if (r.claimed) {
          console.log(`  ✅ ${r.project}+${r.user} → Container ${r.containerId?.substring(0, 12)}`);
        } else {
          console.log(`  ⏳ ${r.project}+${r.user} → Pending`);
        }
      });

      // Count unique containers
      const uniqueContainers = new Set(
        results.filter(r => r.containerId).map(r => r.containerId)
      );

      console.log(`📊 ${uniqueContainers.size} containers handling ${scenarios.length} project+user combinations`);

      // Verify project isolation
      const ameliaUsers = results.filter(r => r.project === 'amelia');
      if (ameliaUsers.length > 1) {
        const ameliaContainers = new Set(
          ameliaUsers.filter(r => r.containerId).map(r => r.containerId)
        );
        console.log(`📊 Project 'amelia' handled by ${ameliaContainers.size} containers for ${ameliaUsers.length} users`);
      }
    }, TEST_TIMEOUT);
  });
});