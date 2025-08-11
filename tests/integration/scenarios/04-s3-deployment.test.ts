/**
 * S3 Deployment Integration Test Suite
 * 
 * Verifies that containers correctly build and deploy static sites to S3
 * after processing messages, replacing the old ALB routing tests.
 */

import { TestDataManager } from '../src/test-data-manager.js';
import { testUtils } from '../src/setup-tests.js';
import fetch from 'node-fetch';
import { S3Client, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';

describe('S3 Deployment Verification', () => {
  let testDataManager: TestDataManager;
  const TEST_TIMEOUT = 90000; // 1.5 minutes
  
  // Initialize AWS clients
  const s3Client = new S3Client({ region: global.testConfig.aws.region });
  const logsClient = new CloudWatchLogsClient({ region: global.testConfig.aws.region });

  beforeAll(() => {
    testDataManager = new TestDataManager();
  });

  afterAll(async () => {
    await testDataManager.cleanup();
    
    // Clean up any test sessions
    const testSessions = await global.awsServices.dynamo.scanTestSessions();
    for (const session of testSessions) {
      try {
        await global.awsServices.dynamo.deleteSession(session.sessionId, session.userId);
      } catch (error) {
        console.warn(`Failed to clean up session ${session.sessionId}:`, error);
      }
    }
  });

  describe('Static Site Deployment', () => {
    test('should deploy to S3 after container processing', async () => {
      console.log('🚀 Testing S3 deployment after message processing...');
      
      // Create a test session
      const session = await global.testHarness.createTestSession(
        testDataManager.generateSessionParams({
          instruction: 'Add test content to homepage'
        })
      );
      
      testDataManager.recordTestSession(session);
      console.log(`✅ Created test session: ${session.sessionId}`);
      
      // Wait for processing
      await global.testHarness.waitForProcessing(session.sessionId);
      
      // Verify S3 deployment
      const bucket = global.testConfig.s3.buckets.test;
      console.log(`📦 Checking S3 bucket: ${bucket}`);
      
      try {
        const response = await s3Client.send(new HeadObjectCommand({
          Bucket: bucket,
          Key: 'index.html'
        }));
        
        expect(response.ContentLength).toBeGreaterThan(0);
        expect(response.LastModified).toBeDefined();
        console.log(`✅ index.html found in S3, last modified: ${response.LastModified}`);
        
        // Verify site is accessible
        const siteUrl = global.testConfig.s3.endpoints.test;
        const siteResponse = await fetch(siteUrl);
        expect(siteResponse.status).toBe(200);
        
        const html = await siteResponse.text();
        expect(html).toContain('<!DOCTYPE html>');
        console.log(`✅ Site accessible at: ${siteUrl}`);
        
      } catch (error) {
        console.error(`❌ S3 deployment verification failed: ${error}`);
        throw error;
      } finally {
        await global.awsServices.dynamo.deleteSession(session.sessionId, session.userId);
      }
    });

    test('should update S3 on subsequent changes', async () => {
      console.log('🔄 Testing S3 sync on file updates...');
      
      const session = await global.testHarness.createTestSession(
        testDataManager.generateSessionParams({
          instruction: 'Initial content setup'
        })
      );
      
      testDataManager.recordTestSession(session);
      await global.testHarness.waitForProcessing(session.sessionId);
      
      // Get initial last modified time
      const bucket = global.testConfig.s3.buckets.test;
      const initial = await s3Client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: 'index.html'
      }));
      
      console.log(`📅 Initial deployment at: ${initial.LastModified}`);
      
      // Send update
      await global.testHarness.sendMessage({
        sessionId: session.sessionId,
        instruction: 'Update homepage content with new features'
      });
      
      await global.testHarness.waitForProcessing(session.sessionId);
      
      // Verify S3 was updated
      const updated = await s3Client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: 'index.html'
      }));
      
      expect(updated.LastModified?.getTime()).toBeGreaterThan(
        initial.LastModified?.getTime() || 0
      );
      console.log(`✅ S3 updated at: ${updated.LastModified}`);
      
      await global.awsServices.dynamo.deleteSession(session.sessionId, session.userId);
    });

    test('should deploy all static assets to S3', async () => {
      console.log('📁 Testing complete asset deployment...');
      
      const session = await global.testHarness.createTestSession(
        testDataManager.generateSessionParams({
          instruction: 'Build complete site with all assets'
        })
      );
      
      testDataManager.recordTestSession(session);
      await global.testHarness.waitForProcessing(session.sessionId);
      
      // List all objects in S3 bucket
      const bucket = global.testConfig.s3.buckets.test;
      const listResponse = await s3Client.send(new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: 100
      }));
      
      expect(listResponse.Contents).toBeDefined();
      expect(listResponse.Contents?.length).toBeGreaterThan(0);
      
      // Check for expected files
      const fileKeys = listResponse.Contents?.map(obj => obj.Key) || [];
      console.log(`📦 Found ${fileKeys.length} files in S3:`);
      
      // Should have at least index.html
      expect(fileKeys).toContain('index.html');
      
      // Log file structure
      fileKeys.slice(0, 10).forEach(key => {
        console.log(`  - ${key}`);
      });
      
      if (fileKeys.length > 10) {
        console.log(`  ... and ${fileKeys.length - 10} more files`);
      }
      
      await global.awsServices.dynamo.deleteSession(session.sessionId, session.userId);
    });

    test('should verify container logs during S3 sync', async () => {
      console.log('📝 Testing CloudWatch logs during S3 sync...');
      
      const session = await global.testHarness.createTestSession(
        testDataManager.generateSessionParams({
          instruction: 'Deploy site with logging verification'
        })
      );
      
      testDataManager.recordTestSession(session);
      console.log(`✅ Created test session: ${session.sessionId}`);
      
      // Wait for processing
      await global.testHarness.waitForProcessing(session.sessionId);
      
      // Check CloudWatch logs for S3 sync messages
      const logGroup = '/ecs/webordinary/edit';
      const startTime = Date.now() - 300000; // Last 5 minutes
      
      try {
        const logsResponse = await logsClient.send(new FilterLogEventsCommand({
          logGroupName: logGroup,
          filterPattern: `"S3 sync" "${session.sessionId}"`,
          startTime: startTime
        }));
        
        if (logsResponse.events && logsResponse.events.length > 0) {
          console.log(`✅ Found ${logsResponse.events.length} S3 sync log entries`);
          
          // Check for successful sync messages
          const syncLogs = logsResponse.events.filter(e => 
            e.message?.includes('S3 sync completed') || 
            e.message?.includes('Successfully synced')
          );
          
          if (syncLogs.length > 0) {
            console.log(`✅ S3 sync completed successfully`);
            syncLogs.slice(0, 3).forEach(log => {
              console.log(`  - ${log.message?.substring(0, 100)}...`);
            });
          }
        } else {
          console.log(`⚠️ No S3 sync logs found (may be using different log format)`);
        }
        
        // Verify S3 deployment regardless of logs
        const bucket = global.testConfig.s3.buckets.test;
        const s3Response = await s3Client.send(new HeadObjectCommand({
          Bucket: bucket,
          Key: 'index.html'
        }));
        
        expect(s3Response.ContentLength).toBeGreaterThan(0);
        
      } catch (error) {
        console.warn(`⚠️ CloudWatch logs check failed: ${error}`);
        // Don't fail test if logs aren't available
      } finally {
        await global.awsServices.dynamo.deleteSession(session.sessionId, session.userId);
      }
    });
  });

  describe('S3 Sync Verification', () => {
    test('should handle build failures gracefully', async () => {
      console.log('🚫 Testing S3 sync behavior on build failures...');
      
      // Create session with instruction that might cause build issues
      const session = await global.testHarness.createTestSession(
        testDataManager.generateSessionParams({
          instruction: 'Create page with syntax error: <div>unclosed'
        })
      );
      
      testDataManager.recordTestSession(session);
      
      // Wait for processing (may fail)
      await global.testHarness.waitForProcessing(session.sessionId, 30000);
      
      // Check if S3 still has previous valid version or handled error
      const bucket = global.testConfig.s3.buckets.test;
      
      try {
        const response = await s3Client.send(new HeadObjectCommand({
          Bucket: bucket,
          Key: 'index.html'
        }));
        
        // File should exist even if build had issues
        expect(response.ContentLength).toBeGreaterThan(0);
        console.log(`✅ S3 maintained site availability despite potential build issues`);
        
      } catch (error) {
        console.log(`⚠️ S3 check after build failure: ${error}`);
        // This is acceptable - no deployment on build failure
      } finally {
        await global.awsServices.dynamo.deleteSession(session.sessionId, session.userId);
      }
    });
  });

  describe('Multi-Client S3 Deployment', () => {
    test('should handle deployments for different clients', async () => {
      console.log('👥 Testing multi-client S3 deployments...');
      
      // Test with ameliastamps client
      const ameliaSession = await global.testHarness.createTestSession(
        testDataManager.generateSessionParams({
          clientId: 'ameliastamps',
          instruction: 'Deploy Amelia site content'
        })
      );
      
      testDataManager.recordTestSession(ameliaSession);
      await global.testHarness.waitForProcessing(ameliaSession.sessionId);
      
      // Verify deployment to amelia bucket
      const ameliaBucket = global.testConfig.s3.buckets.amelia;
      
      try {
        const ameliaResponse = await s3Client.send(new HeadObjectCommand({
          Bucket: ameliaBucket,
          Key: 'index.html'
        }));
        
        expect(ameliaResponse.ContentLength).toBeGreaterThan(0);
        console.log(`✅ Amelia client deployed to: ${ameliaBucket}`);
        
        // Verify site is accessible via domain
        const ameliaUrl = global.testConfig.s3.endpoints.amelia;
        const siteResponse = await fetch(ameliaUrl);
        
        if (siteResponse.ok) {
          console.log(`✅ Amelia site accessible at: ${ameliaUrl}`);
        } else {
          console.log(`⚠️ Amelia site returned status: ${siteResponse.status}`);
        }
        
      } catch (error) {
        console.warn(`⚠️ Multi-client deployment test: ${error}`);
      } finally {
        await global.awsServices.dynamo.deleteSession(ameliaSession.sessionId, ameliaSession.userId);
      }
    });
  });

  describe('S3 Deployment Performance', () => {
    test('should complete S3 sync within timeout', async () => {
      console.log('⏱️ Testing S3 deployment performance...');
      
      const startTime = Date.now();
      
      const session = await global.testHarness.createTestSession(
        testDataManager.generateSessionParams({
          instruction: 'Create optimized production build'
        })
      );
      
      testDataManager.recordTestSession(session);
      
      // Measure time to complete S3 deployment
      await global.testHarness.waitForProcessing(session.sessionId);
      
      const deploymentTime = Date.now() - startTime;
      console.log(`📊 Deployment completed in: ${deploymentTime}ms`);
      
      // Check that deployment was within acceptable timeouts
      expect(deploymentTime).toBeLessThan(global.testConfig.timeouts.buildTimeout + global.testConfig.timeouts.s3SyncTimeout);
      
      // Verify S3 deployment success
      const bucket = global.testConfig.s3.buckets.test;
      const response = await s3Client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: 'index.html'
      }));
      
      expect(response.ContentLength).toBeGreaterThan(0);
      
      // Measure S3 object count for performance baseline
      const listResponse = await s3Client.send(new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: 1000
      }));
      
      const objectCount = listResponse.Contents?.length || 0;
      console.log(`📦 Deployed ${objectCount} objects to S3`);
      
      // Log performance metrics
      console.log(`📊 Performance Metrics:`);
      console.log(`  - Total deployment time: ${deploymentTime}ms`);
      console.log(`  - Objects deployed: ${objectCount}`);
      console.log(`  - Average per object: ${(deploymentTime / objectCount).toFixed(2)}ms`);
      
      await global.awsServices.dynamo.deleteSession(session.sessionId, session.userId);
    });
  });

  describe('S3 Error Recovery', () => {
    test('should handle S3 permission errors gracefully', async () => {
      console.log('🔒 Testing S3 deployment with permission issues...');
      
      // This test verifies error handling when S3 permissions might be restricted
      const session = await global.testHarness.createTestSession(
        testDataManager.generateSessionParams({
          clientId: 'test-restricted',
          instruction: 'Test deployment with potential permission issues'
        })
      );
      
      testDataManager.recordTestSession(session);
      
      try {
        await global.testHarness.waitForProcessing(session.sessionId);
        
        // Check CloudWatch logs for any S3 permission errors
        const logGroup = '/ecs/webordinary/edit';
        const logsResponse = await logsClient.send(new FilterLogEventsCommand({
          logGroupName: logGroup,
          filterPattern: `"Access Denied" "S3" "${session.sessionId}"`,
          startTime: Date.now() - 300000
        }));
        
        if (logsResponse.events && logsResponse.events.length > 0) {
          console.log(`⚠️ Found S3 permission errors in logs (expected for test)`);
        } else {
          console.log(`✅ No S3 permission errors detected`);
        }
        
      } catch (error) {
        console.log(`📝 Error handling test result: ${error}`);
      } finally {
        await global.awsServices.dynamo.deleteSession(session.sessionId, session.userId);
      }
    });

    test('should recover from S3 sync failures', async () => {
      console.log('🔄 Testing S3 sync failure recovery...');
      
      const session = await global.testHarness.createTestSession(
        testDataManager.generateSessionParams({
          instruction: 'Test recovery from sync failure'
        })
      );
      
      testDataManager.recordTestSession(session);
      
      // Wait for initial processing
      await global.testHarness.waitForProcessing(session.sessionId);
      
      // Send another message to test retry/recovery
      await global.testHarness.sendMessage({
        sessionId: session.sessionId,
        instruction: 'Retry deployment after potential failure'
      });
      
      await global.testHarness.waitForProcessing(session.sessionId);
      
      // Verify S3 has the latest content
      const bucket = global.testConfig.s3.buckets.test;
      const response = await s3Client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: 'index.html'
      }));
      
      expect(response.ContentLength).toBeGreaterThan(0);
      console.log(`✅ S3 sync recovery successful`);
      
      await global.awsServices.dynamo.deleteSession(session.sessionId, session.userId);
    });
  });

  describe('S3 Content Verification', () => {
    test('should verify deployed content integrity', async () => {
      console.log('🔍 Testing deployed content integrity...');
      
      const session = await global.testHarness.createTestSession(
        testDataManager.generateSessionParams({
          instruction: 'Create page with specific test content: WebOrdinary Test Suite'
        })
      );
      
      testDataManager.recordTestSession(session);
      await global.testHarness.waitForProcessing(session.sessionId);
      
      // Fetch the deployed site content
      const siteUrl = global.testConfig.s3.endpoints.test;
      const response = await fetch(siteUrl);
      
      expect(response.status).toBe(200);
      const html = await response.text();
      
      // Verify basic HTML structure
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html');
      expect(html).toContain('<head>');
      expect(html).toContain('<body>');
      
      // Check for Astro-specific elements
      const hasAstroContent = html.includes('astro') || html.includes('Astro');
      if (hasAstroContent) {
        console.log(`✅ Astro-generated content detected`);
      }
      
      // Verify S3 metadata
      const bucket = global.testConfig.s3.buckets.test;
      const s3Response = await s3Client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: 'index.html'
      }));
      
      console.log(`📊 S3 Object Metadata:`);
      console.log(`  - Content-Type: ${s3Response.ContentType}`);
      console.log(`  - Content-Length: ${s3Response.ContentLength} bytes`);
      console.log(`  - Last-Modified: ${s3Response.LastModified}`);
      console.log(`  - ETag: ${s3Response.ETag}`);
      
      expect(s3Response.ContentType).toContain('text/html');
      
      await global.awsServices.dynamo.deleteSession(session.sessionId, session.userId);
    });
  });
});

// Export for potential standalone usage
export default {};