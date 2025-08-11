import { Test, TestingModule } from '@nestjs/testing';
import { AutoSleepService } from './auto-sleep.service';
import { GitService } from './git.service';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

// Mock AWS SDK
jest.mock('@aws-sdk/client-dynamodb');

// Mock process.exit to prevent test termination
const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('Process exit called');
});

describe('AutoSleepService Integration Tests', () => {
  let service: AutoSleepService;
  let gitService: jest.Mocked<GitService>;
  let mockDynamoClient: jest.Mocked<DynamoDBClient>;

  beforeEach(async () => {
    const mockGitService = {
      hasUncommittedChanges: jest.fn(),
      stageChanges: jest.fn(),
      commit: jest.fn(),
      push: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoSleepService,
        {
          provide: GitService,
          useValue: mockGitService,
        },
      ],
    }).compile();

    service = module.get<AutoSleepService>(AutoSleepService);
    gitService = module.get(GitService);

    // Get mocked DynamoDB client
    mockDynamoClient = (service as any).dynamodb;
    mockDynamoClient.send = jest.fn();

    // Mock environment variables
    process.env.DEFAULT_CLIENT_ID = 'testclient';
    process.env.DEFAULT_USER_ID = 'testuser';
    process.env.THREAD_ID = 'thread-test';
    process.env.CONTAINER_IP = '10.0.1.100';
    process.env.TASK_ARN = 'arn:aws:ecs:us-west-2:123:task/test-task';
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.stop();
  });

  describe('Initialization', () => {
    it('should initialize container in DynamoDB', async () => {
      mockDynamoClient.send.mockResolvedValueOnce({});

      await service.onModuleInit();

      expect(mockDynamoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'webordinary-containers',
            Key: { containerId: { S: 'testclient-thread-test-testuser' } },
            UpdateExpression: expect.stringContaining('SET #status = :status')
          })
        })
      );
    });

    it('should handle DynamoDB initialization errors', async () => {
      mockDynamoClient.send.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

      // Should not throw, just log error
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('Activity Recording', () => {
    beforeEach(async () => {
      mockDynamoClient.send.mockResolvedValue({});
      await service.onModuleInit();
      jest.clearAllMocks();
    });

    it('should record activity and update DynamoDB after 1 minute', async () => {
      const initialTime = Date.now();
      
      // First activity - should not update DynamoDB immediately
      service.recordActivity('test-source');
      expect(mockDynamoClient.send).not.toHaveBeenCalled();

      // Wait 61 seconds (mocked)
      jest.spyOn(Date, 'now').mockReturnValue(initialTime + 61000);
      
      service.recordActivity('test-source-2');
      
      expect(mockDynamoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'webordinary-containers',
            UpdateExpression: 'SET lastActivity = :now'
          })
        })
      );
    });

    it('should handle DynamoDB update errors gracefully', async () => {
      mockDynamoClient.send.mockRejectedValueOnce(new Error('DynamoDB error'));
      
      // Should not throw
      expect(() => service.recordActivity('test')).not.toThrow();
    });
  });

  describe('Idle State Management', () => {
    beforeEach(async () => {
      mockDynamoClient.send.mockResolvedValue({});
      await service.onModuleInit();
      jest.clearAllMocks();
    });

    it('should stay active when sessions exist', async () => {
      // Mock active sessions found
      mockDynamoClient.send.mockResolvedValueOnce({
        Count: 2
      });

      // Mock 21 minutes of idle time
      const idleTime = 21 * 60 * 1000;
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + idleTime);

      // Manually trigger idle check
      await (service as any).checkIdleState();

      expect(mockDynamoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'webordinary-thread-mappings',
            IndexName: 'container-index'
          })
        })
      );

      // Should not initiate shutdown
      expect(gitService.hasUncommittedChanges).not.toHaveBeenCalled();
    });

    it('should initiate shutdown when no sessions exist', async () => {
      // Mock no active sessions
      mockDynamoClient.send.mockResolvedValueOnce({
        Count: 0
      });

      // Mock container status update
      mockDynamoClient.send.mockResolvedValueOnce({});

      // Mock git operations
      gitService.hasUncommittedChanges.mockResolvedValueOnce(true);
      gitService.stageChanges.mockResolvedValueOnce();
      gitService.commit.mockResolvedValueOnce();
      gitService.push.mockResolvedValueOnce();

      // Mock 21 minutes of idle time
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 21 * 60 * 1000);

      // Should throw because process.exit is mocked to throw
      await expect((service as any).checkIdleState()).rejects.toThrow('Process exit called');

      // Should have called git save operations
      expect(gitService.hasUncommittedChanges).toHaveBeenCalled();
      expect(gitService.stageChanges).toHaveBeenCalledWith(
        process.env.WORKSPACE_PATH || '/workspace',
        '.'
      );
      expect(gitService.commit).toHaveBeenCalled();
      expect(gitService.push).toHaveBeenCalled();

      // Should have updated container status to stopping
      expect(mockDynamoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            UpdateExpression: 'SET #status = :status, stoppedAt = :now',
            ExpressionAttributeValues: expect.objectContaining({
              ':status': { S: 'stopping' }
            })
          })
        })
      );
    });

    it('should handle git save errors gracefully', async () => {
      // Mock no active sessions
      mockDynamoClient.send.mockResolvedValueOnce({ Count: 0 });
      mockDynamoClient.send.mockResolvedValueOnce({}); // Status update

      // Mock git operations with errors
      gitService.hasUncommittedChanges.mockResolvedValueOnce(true);
      gitService.stageChanges.mockRejectedValueOnce(new Error('Git error'));

      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 21 * 60 * 1000);

      // Should still attempt shutdown despite git errors
      await expect((service as any).checkIdleState()).rejects.toThrow('Process exit called');

      expect(gitService.hasUncommittedChanges).toHaveBeenCalled();
      expect(gitService.stageChanges).toHaveBeenCalled();
      // Should not call subsequent git operations after error
      expect(gitService.commit).not.toHaveBeenCalled();
    });

    it('should skip git save when no changes exist', async () => {
      // Mock no active sessions
      mockDynamoClient.send.mockResolvedValueOnce({ Count: 0 });
      mockDynamoClient.send.mockResolvedValueOnce({}); // Status update

      // Mock no git changes
      gitService.hasUncommittedChanges.mockResolvedValueOnce(false);

      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 21 * 60 * 1000);

      await expect((service as any).checkIdleState()).rejects.toThrow('Process exit called');

      expect(gitService.hasUncommittedChanges).toHaveBeenCalled();
      expect(gitService.stageChanges).not.toHaveBeenCalled();
      expect(gitService.commit).not.toHaveBeenCalled();
      expect(gitService.push).not.toHaveBeenCalled();
    });
  });

  describe('Status Reporting', () => {
    beforeEach(async () => {
      mockDynamoClient.send.mockResolvedValue({});
      await service.onModuleInit();
      jest.clearAllMocks();
    });

    it('should report active status when recently active', () => {
      service.recordActivity('recent-activity');

      const status = service.getStatus();

      expect(status).toEqual({
        containerId: 'testclient-thread-test-testuser',
        lastActivity: expect.any(String),
        idleTime: expect.any(Number),
        isIdle: false,
        status: 'active',
        timeUntilSleep: expect.any(Number)
      });

      expect(status.idleTime).toBeLessThan(1000); // Less than 1 second
      expect(status.timeUntilSleep).toBeGreaterThan(19 * 60); // More than 19 minutes
    });

    it('should report idle status when inactive for too long', () => {
      // Mock 21 minutes of idle time
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 21 * 60 * 1000);

      const status = service.getStatus();

      expect(status.isIdle).toBe(true);
      expect(status.status).toBe('idle');
      expect(status.timeUntilSleep).toBe(0);
      expect(status.idleTime).toBeGreaterThan(20 * 60); // More than 20 minutes
    });
  });

  describe('Session Counting', () => {
    beforeEach(async () => {
      mockDynamoClient.send.mockResolvedValue({});
      await service.onModuleInit();
      jest.clearAllMocks();
    });

    it('should handle session counting errors safely', async () => {
      mockDynamoClient.send.mockRejectedValueOnce(new Error('DynamoDB query failed'));

      const sessionCount = await (service as any).getActiveSessions();

      // Should return 1 (safe default) when unable to query
      expect(sessionCount).toBe(1);
    });

    it('should return correct session count', async () => {
      mockDynamoClient.send.mockResolvedValueOnce({
        Count: 3
      });

      const sessionCount = await (service as any).getActiveSessions();

      expect(sessionCount).toBe(3);
      expect(mockDynamoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'webordinary-thread-mappings',
            IndexName: 'container-index',
            KeyConditionExpression: 'containerId = :cid',
            Select: 'COUNT'
          })
        })
      );
    });
  });

  describe('Lifecycle Management', () => {
    beforeEach(async () => {
      mockDynamoClient.send.mockResolvedValue({});
      await service.onModuleInit();
      jest.clearAllMocks();
    });

    it('should start and stop monitoring', () => {
      // Should start monitoring on init
      expect((service as any).idleCheckInterval).toBeDefined();

      service.stop();
      
      // Should stop monitoring
      expect((service as any).idleCheckInterval).toBeUndefined();
    });

    it('should handle start/stop multiple times safely', () => {
      service.start();
      service.start(); // Should not create multiple intervals
      
      expect((service as any).idleCheckInterval).toBeDefined();

      service.stop();
      service.stop(); // Should handle multiple stops gracefully
      
      expect((service as any).idleCheckInterval).toBeUndefined();
    });

    it('should clean up on module destroy', async () => {
      const stopSpy = jest.spyOn(service, 'stop');
      
      await service.onModuleDestroy();
      
      expect(stopSpy).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle DynamoDB service unavailable', async () => {
      mockDynamoClient.send.mockRejectedValue(new Error('Service unavailable'));

      // Should not throw during initialization
      await expect(service.onModuleInit()).resolves.toBeUndefined();

      // Should not throw during activity recording
      expect(() => service.recordActivity('test')).not.toThrow();
    });

    it('should handle malformed DynamoDB responses', async () => {
      // Mock malformed response
      mockDynamoClient.send.mockResolvedValueOnce({
        Items: [{ malformed: 'data' }]
      });

      const sessionCount = await (service as any).getActiveSessions();

      // Should return safe default
      expect(sessionCount).toBe(1);
    });
  });
});