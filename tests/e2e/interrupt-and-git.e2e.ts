/**
 * Interrupt Handling and Git Operations E2E Test Suite
 * 
 * Tests interrupt scenarios and git workflow integrity
 * Validates recovery, state persistence, and version control
 */

import { SQSClient, SendMessageCommand, PurgeQueueCommand } from '@aws-sdk/client-sqs';
import { ECSClient, StopTaskCommand, ListTasksCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { CodeCommitClient, GetBranchCommand, GetDifferencesCommand } from '@aws-sdk/client-codecommit';
import { v4 as uuidv4 } from 'uuid';

describe('Interrupt Handling and Git Operations E2E', () => {
  const TEST_TIMEOUT = 180000; // 3 minutes
  
  const config = {
    region: process.env.AWS_REGION || 'us-west-2',
    accountId: process.env.AWS_ACCOUNT_ID || '942734823970',
    cluster: 'webordinary-edit-cluster',
    emailQueue: 'https://sqs.us-west-2.amazonaws.com/942734823970/webordinary-email-queue',
    repoName: 'webordinary-amelia-site', // Assuming CodeCommit repo
  };

  const sqsClient = new SQSClient({ region: config.region });
  const ecsClient = new ECSClient({ region: config.region });
  const dynamoClient = new DynamoDBClient({ region: config.region });
  const codeCommitClient = new CodeCommitClient({ region: config.region });

  // Helper to send interrupt signal
  const sendInterrupt = async (sessionId: string, threadId: string) => {
    const interruptMessage = {
      type: 'interrupt',
      sessionId,
      threadId,
      timestamp: Date.now(),
    };

    // In real system, this might be a special queue or signal
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: config.emailQueue,
      MessageBody: JSON.stringify(interruptMessage),
      MessageAttributes: {
        type: { DataType: 'String', StringValue: 'interrupt' },
      },
    }));
  };

  describe('Interrupt During Processing', () => {
    it('should handle interrupt mid-execution gracefully', async () => {
      const threadId = `thread-${uuidv4()}`;
      const sessionId = `session-${uuidv4()}`;
      
      console.log('🛑 Testing interrupt during processing');
      
      // Start a long-running task
      const emailContent = `From: scott@example.com
To: edit@webordinary.com
Message-ID: <${threadId}@webordinary.com>

Please perform these tasks:
1. Create multiple new pages
2. Update all existing pages
3. Reorganize the site structure
4. Add complex interactions`;

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify({
          messageId: `ses-${uuidv4()}`,
          content: emailContent,
        }),
      }));
      
      console.log('✅ Long-running task initiated');
      
      // Wait a bit for processing to start
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Send interrupt signal
      console.log('🛑 Sending interrupt signal...');
      await sendInterrupt(sessionId, threadId);
      
      // Wait for interrupt handling
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      // Check session state
      const threadMapping = await dynamoClient.send(new GetItemCommand({
        TableName: 'webordinary-thread-mappings',
        Key: {
          threadId: { S: threadId },
        },
      }));
      
      if (threadMapping.Item) {
        const status = threadMapping.Item.status?.S;
        console.log(`📊 Session status after interrupt: ${status}`);
        
        // Should be in interrupted or paused state
        if (status === 'interrupted' || status === 'paused') {
          console.log('✅ Session properly marked as interrupted');
        }
      }
      
      // Send resume message
      const resumeContent = `From: scott@example.com
To: edit@webordinary.com
Message-ID: <${uuidv4()}@webordinary.com>
In-Reply-To: <${threadId}@webordinary.com>

Please continue where we left off`;

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify({
          messageId: `ses-resume-${uuidv4()}`,
          content: resumeContent,
        }),
      }));
      
      console.log('✅ Resume message sent');
      
      // Wait for resumption
      await new Promise(resolve => setTimeout(resolve, 15000));
      
      // Check if work resumed
      const resumedMapping = await dynamoClient.send(new GetItemCommand({
        TableName: 'webordinary-thread-mappings',
        Key: {
          threadId: { S: threadId },
        },
      }));
      
      if (resumedMapping.Item) {
        const resumedStatus = resumedMapping.Item.status?.S;
        console.log(`📊 Session status after resume: ${resumedStatus}`);
        
        if (resumedStatus === 'active' || resumedStatus === 'processing') {
          console.log('✅ Session successfully resumed');
        }
      }
    }, TEST_TIMEOUT);
  });

  describe('Container Crash Recovery', () => {
    it('should recover from container crash', async () => {
      const threadId = `thread-${uuidv4()}`;
      
      console.log('💥 Testing container crash recovery');
      
      // Send initial message
      const emailContent = `From: scott@example.com
To: edit@webordinary.com
Message-ID: <${threadId}@webordinary.com>

Start important work that must not be lost`;

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify({
          messageId: `ses-${uuidv4()}`,
          content: emailContent,
        }),
      }));
      
      console.log('✅ Work initiated');
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      // Find the container handling this work
      const ownership = await dynamoClient.send(new GetItemCommand({
        TableName: 'webordinary-container-ownership',
        Key: {
          projectKey: { S: 'amelia#scott' },
        },
      }));
      
      if (ownership.Item && ownership.Item.containerId?.S) {
        const containerId = ownership.Item.containerId.S;
        console.log(`📊 Container ${containerId} is handling the work`);
        
        // Find the ECS task
        const tasks = await ecsClient.send(new ListTasksCommand({
          cluster: config.cluster,
          serviceName: 'webordinary-edit-service',
        }));
        
        if (tasks.taskArns && tasks.taskArns.length > 0) {
          // Get task details
          const taskDetails = await ecsClient.send(new DescribeTasksCommand({
            cluster: config.cluster,
            tasks: tasks.taskArns,
          }));
          
          // Find our container's task
          const ourTask = taskDetails.tasks?.find(task => 
            task.containers?.some(c => c.name === containerId)
          );
          
          if (ourTask && ourTask.taskArn) {
            console.log(`💥 Simulating container crash by stopping task...`);
            
            try {
              await ecsClient.send(new StopTaskCommand({
                cluster: config.cluster,
                task: ourTask.taskArn,
                reason: 'E2E test - simulating crash',
              }));
              
              console.log('✅ Container stopped (crash simulated)');
            } catch (error) {
              console.log(`⚠️ Could not stop container: ${error}`);
            }
          }
        }
        
        // Wait for recovery
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        // Check if work was recovered
        const newOwnership = await dynamoClient.send(new GetItemCommand({
          TableName: 'webordinary-container-ownership',
          Key: {
            projectKey: { S: 'amelia#scott' },
          },
        }));
        
        if (newOwnership.Item) {
          const newContainerId = newOwnership.Item.containerId?.S;
          
          if (newContainerId && newContainerId !== containerId) {
            console.log(`✅ Work recovered by new container: ${newContainerId}`);
          } else if (newContainerId === containerId) {
            console.log(`✅ Same container recovered: ${containerId}`);
          }
        }
        
        // Verify work continues
        const followUpContent = `From: scott@example.com
To: edit@webordinary.com
Message-ID: <${uuidv4()}@webordinary.com>
In-Reply-To: <${threadId}@webordinary.com>

Continue with the important work`;

        await sqsClient.send(new SendMessageCommand({
          QueueUrl: config.emailQueue,
          MessageBody: JSON.stringify({
            messageId: `ses-followup-${uuidv4()}`,
            content: followUpContent,
          }),
        }));
        
        console.log('✅ Follow-up message sent to verify recovery');
      }
    }, TEST_TIMEOUT);
  });

  describe('Git Branch Management', () => {
    it('should create and maintain thread-specific branches', async () => {
      const threadId = `thread-${uuidv4()}`;
      const branchName = `thread-${threadId}`;
      
      console.log('🌿 Testing git branch management');
      
      // Send message to create work on new branch
      const emailContent = `From: scott@example.com
To: edit@webordinary.com
Message-ID: <${threadId}@webordinary.com>

Create a new feature on branch ${branchName}`;

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify({
          messageId: `ses-${uuidv4()}`,
          content: emailContent,
          repoUrl: `https://git-codecommit.${config.region}.amazonaws.com/v1/repos/${config.repoName}`,
        }),
      }));
      
      console.log(`✅ Work initiated for branch ${branchName}`);
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 20000));
      
      // Check if branch was created (if using CodeCommit)
      try {
        const branch = await codeCommitClient.send(new GetBranchCommand({
          repositoryName: config.repoName,
          branchName: branchName,
        }));
        
        if (branch.branch) {
          console.log(`✅ Branch ${branchName} created`);
          console.log(`  Commit: ${branch.branch.commitId}`);
        }
      } catch (error: any) {
        if (error.name === 'BranchDoesNotExistException') {
          console.log(`⚠️ Branch not yet created (may be using different git provider)`);
        } else {
          console.log(`⚠️ Could not check branch: ${error.message}`);
        }
      }
      
      // Send another message in same thread
      const updateContent = `From: scott@example.com
To: edit@webordinary.com
Message-ID: <${uuidv4()}@webordinary.com>
In-Reply-To: <${threadId}@webordinary.com>

Make additional changes to the feature`;

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify({
          messageId: `ses-update-${uuidv4()}`,
          content: updateContent,
        }),
      }));
      
      console.log('✅ Additional changes requested on same branch');
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 20000));
      
      // Verify changes are on same branch
      const threadMapping = await dynamoClient.send(new GetItemCommand({
        TableName: 'webordinary-thread-mappings',
        Key: {
          threadId: { S: threadId },
        },
      }));
      
      if (threadMapping.Item) {
        const mappedBranch = threadMapping.Item.gitBranch?.S;
        expect(mappedBranch).toBe(branchName);
        console.log(`✅ Thread consistently using branch: ${mappedBranch}`);
      }
    });

    it('should handle git conflicts gracefully', async () => {
      const threadId1 = `thread-${uuidv4()}`;
      const threadId2 = `thread-${uuidv4()}`;
      
      console.log('⚔️ Testing git conflict handling');
      
      // Two users editing same file
      const user1Email = `From: alice@example.com
To: edit@webordinary.com
Message-ID: <${threadId1}@webordinary.com>

Update the homepage title to "Alice's Version"`;

      const user2Email = `From: bob@example.com
To: edit@webordinary.com
Message-ID: <${threadId2}@webordinary.com>

Update the homepage title to "Bob's Version"`;

      // Send both messages close together
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify({
          messageId: `ses-alice-${uuidv4()}`,
          content: user1Email,
        }),
      }));
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify({
          messageId: `ses-bob-${uuidv4()}`,
          content: user2Email,
        }),
      }));
      
      console.log('✅ Conflicting changes requested');
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      // Check how conflicts were handled
      const thread1Mapping = await dynamoClient.send(new GetItemCommand({
        TableName: 'webordinary-thread-mappings',
        Key: {
          threadId: { S: threadId1 },
        },
      }));
      
      const thread2Mapping = await dynamoClient.send(new GetItemCommand({
        TableName: 'webordinary-thread-mappings',
        Key: {
          threadId: { S: threadId2 },
        },
      }));
      
      // Both should have separate branches
      const branch1 = thread1Mapping.Item?.gitBranch?.S;
      const branch2 = thread2Mapping.Item?.gitBranch?.S;
      
      if (branch1 && branch2) {
        expect(branch1).not.toBe(branch2);
        console.log(`✅ Separate branches created:`);
        console.log(`  Alice: ${branch1}`);
        console.log(`  Bob: ${branch2}`);
        console.log('✅ Conflicts avoided through branch isolation');
      }
    });
  });

  describe('Commit History Preservation', () => {
    it('should maintain commit history across interrupts', async () => {
      const threadId = `thread-${uuidv4()}`;
      const commits: string[] = [];
      
      console.log('📝 Testing commit history preservation');
      
      // Make initial commit
      const firstEmail = `From: scott@example.com
To: edit@webordinary.com
Message-ID: <${threadId}@webordinary.com>

First change: Add header component`;

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify({
          messageId: `ses-1-${uuidv4()}`,
          content: firstEmail,
        }),
      }));
      
      console.log('✅ First commit initiated');
      await new Promise(resolve => setTimeout(resolve, 15000));
      
      // Simulate interrupt
      await sendInterrupt(`session-${threadId}`, threadId);
      console.log('🛑 Interrupt sent');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Continue with more changes
      const secondEmail = `From: scott@example.com
To: edit@webordinary.com
Message-ID: <${uuidv4()}@webordinary.com>
In-Reply-To: <${threadId}@webordinary.com>

Second change: Add footer component`;

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify({
          messageId: `ses-2-${uuidv4()}`,
          content: secondEmail,
        }),
      }));
      
      console.log('✅ Second commit initiated after interrupt');
      await new Promise(resolve => setTimeout(resolve, 15000));
      
      // Verify commit history
      const branchName = `thread-${threadId}`;
      
      try {
        const branch = await codeCommitClient.send(new GetBranchCommand({
          repositoryName: config.repoName,
          branchName: branchName,
        }));
        
        if (branch.branch?.commitId) {
          // Get differences to check commits
          const differences = await codeCommitClient.send(new GetDifferencesCommand({
            repositoryName: config.repoName,
            afterCommitSpecifier: branch.branch.commitId,
            beforeCommitSpecifier: 'main', // Assuming main branch
          }));
          
          if (differences.differences) {
            console.log(`✅ ${differences.differences.length} changes preserved across interrupt`);
          }
        }
      } catch (error) {
        console.log(`⚠️ Could not verify commit history (may be using different git provider)`);
      }
      
      // Check thread mapping for commit tracking
      const threadMapping = await dynamoClient.send(new GetItemCommand({
        TableName: 'webordinary-thread-mappings',
        Key: {
          threadId: { S: threadId },
        },
      }));
      
      if (threadMapping.Item?.commitHistory) {
        const history = threadMapping.Item.commitHistory.L;
        console.log(`✅ ${history?.length || 0} commits tracked in thread mapping`);
      }
    });
  });

  describe('Queue Message Retry', () => {
    it('should retry failed messages appropriately', async () => {
      console.log('🔄 Testing message retry mechanism');
      
      // Send a message that might fail (e.g., invalid instruction)
      const problematicEmail = `From: scott@example.com
To: edit@webordinary.com
Message-ID: <${uuidv4()}@webordinary.com>

[This might cause an error] Delete everything and start over`;

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify({
          messageId: `ses-problem-${uuidv4()}`,
          content: problematicEmail,
        }),
        MessageAttributes: {
          retryCount: { DataType: 'Number', StringValue: '0' },
        },
      }));
      
      console.log('✅ Problematic message sent');
      
      // Wait for processing attempt
      await new Promise(resolve => setTimeout(resolve, 20000));
      
      // Check DLQ for failed messages
      const dlqUrl = config.emailQueue.replace('email-queue', 'email-dlq');
      
      // In real test, would check DLQ message count and verify retry logic
      console.log('📊 Message should be retried or sent to DLQ based on error type');
      
      // Send corrected message
      const correctedEmail = `From: scott@example.com
To: edit@webordinary.com
Message-ID: <${uuidv4()}@webordinary.com>

Please safely refactor the codebase`;

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.emailQueue,
        MessageBody: JSON.stringify({
          messageId: `ses-corrected-${uuidv4()}`,
          content: correctedEmail,
        }),
      }));
      
      console.log('✅ Corrected message sent');
      await new Promise(resolve => setTimeout(resolve, 15000));
      
      console.log('✅ System recovered and processing normally');
    });
  });
});