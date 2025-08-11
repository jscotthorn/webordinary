# Task 25: Client Management and Operational Enhancements

## Objective
Enhance the multi-client foundation with advanced client management features, monitoring, operational tools, and client-specific customization capabilities. This task transforms the basic multi-client architecture into a production-ready platform with comprehensive client lifecycle management.

## Background
Task 24 established the foundational multi-client architecture with basic client configuration and routing. This task adds the operational sophistication needed for a production SaaS platform, including client management interfaces, monitoring, advanced configuration options, and operational tooling.

## Requirements

### Client Management Interface
1. **Client Management Dashboard**
   - Web-based admin interface for client management
   - Client creation, editing, and deactivation
   - Real-time client status and health monitoring
   - Client usage analytics and billing data

2. **Client Management API**
   - RESTful API for client lifecycle operations
   - Client configuration validation and updates
   - Bulk operations for client management
   - Integration hooks for external systems

### Advanced Client Configuration
3. **Extended Client Configuration Schema**
   ```typescript
   interface ClientConfig {
     // ... existing fields from Task 24
     features: {
       aiAssistant: boolean;
       collaborativeEditing: boolean;
       customDomains: boolean;
       apiAccess: boolean;
       webhooks: boolean;
     };
     customization: {
       branding: {
         logo?: string;
         primaryColor?: string;
         favicon?: string;
       };
       ui: {
         theme: 'light' | 'dark' | 'auto';
         customCss?: string;
       };
     };
     limits: {
       monthlyEditHours: number;
       storageLimitGB: number;
       bandwidthLimitGB: number;
       concurrentSessions: number;
     };
     billing: {
       plan: 'free' | 'starter' | 'professional' | 'enterprise';
       monthlyFee: number;
       usageBasedBilling: boolean;
     };
     notifications: {
       webhookUrl?: string;
       emailNotifications: boolean;
       slackIntegration?: {
         webhookUrl: string;
         channel: string;
       };
     };
   }
   ```

4. **Feature Flag System**
   - Client-specific feature enablement
   - Gradual rollout of new features
   - A/B testing capabilities per client
   - Runtime feature toggle without deployments

### Monitoring and Observability
5. **Client-Specific Monitoring**
   - CloudWatch dashboards per client
   - Client-specific metrics and alarms
   - Usage tracking and billing metrics
   - Performance monitoring per client

6. **Operational Alerting**
   - Client container health monitoring
   - Resource usage alerts
   - Error rate monitoring per client
   - Automated incident response

### Client Lifecycle Management
7. **Client Onboarding Workflow**
   - Guided client setup process
   - Repository validation and testing
   - Domain verification and SSL setup
   - Initial deployment and health checks

8. **Client Maintenance Operations**
   - Client data backup and restore
   - Client configuration versioning
   - Client migration tools
   - Client deactivation and cleanup

## Implementation Plan

### Phase 1: Client Management Interface (Week 1)

#### Day 1-3: Admin Dashboard
```typescript
// New service: client-admin-dashboard/
import { ClientConfigService } from '../hermes/src/modules/client-config';

export class ClientAdminController {
  constructor(private clientConfigService: ClientConfigService) {}

  @Get('/clients')
  async listClients(): Promise<ClientSummary[]> {
    const clients = await this.clientConfigService.listAll();
    return clients.map(client => ({
      clientId: client.clientId,
      status: await this.getClientStatus(client.clientId),
      lastActivity: await this.getLastActivity(client.clientId),
      currentUsage: await this.getCurrentUsage(client.clientId),
      plan: client.billing.plan
    }));
  }

  @Post('/clients')
  async createClient(@Body() createClientDto: CreateClientDto): Promise<ClientConfig> {
    // Validate configuration
    await this.validateClientConfig(createClientDto);
    
    // Create infrastructure resources
    await this.provisionClientInfrastructure(createClientDto);
    
    // Store configuration
    const config = await this.clientConfigService.createConfig(createClientDto);
    
    // Initialize monitoring
    await this.setupClientMonitoring(config.clientId);
    
    return config;
  }

  @Put('/clients/:clientId')
  async updateClient(
    @Param('clientId') clientId: string,
    @Body() updateDto: UpdateClientDto
  ): Promise<ClientConfig> {
    const existingConfig = await this.clientConfigService.getConfig(clientId);
    if (!existingConfig) {
      throw new NotFoundException(`Client ${clientId} not found`);
    }

    // Validate updates
    await this.validateConfigUpdate(existingConfig, updateDto);
    
    // Apply configuration changes
    const updatedConfig = { ...existingConfig, ...updateDto };
    await this.clientConfigService.updateConfig(updatedConfig);
    
    // Update infrastructure if needed
    await this.updateClientInfrastructure(clientId, updateDto);
    
    return updatedConfig;
  }

  @Delete('/clients/:clientId')
  async deactivateClient(@Param('clientId') clientId: string): Promise<void> {
    // Graceful shutdown of client containers
    await this.shutdownClientContainers(clientId);
    
    // Archive client data
    await this.archiveClientData(clientId);
    
    // Clean up infrastructure
    await this.cleanupClientInfrastructure(clientId);
    
    // Mark as deactivated
    await this.clientConfigService.deactivateClient(clientId);
  }
}
```

#### Day 4-5: Management API and Validation
```typescript
// Enhanced ClientConfigService
export class ClientConfigService {
  async validateConfig(config: Partial<ClientConfig>): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    // Validate domains
    if (config.domains) {
      if (!this.isValidDomain(config.domains.production)) {
        errors.push({ field: 'domains.production', message: 'Invalid domain format' });
      }
      if (!this.isValidDomain(config.domains.edit)) {
        errors.push({ field: 'domains.edit', message: 'Invalid edit domain format' });
      }
    }

    // Validate repository access
    if (config.repository) {
      const repoAccess = await this.validateRepositoryAccess(config.repository);
      if (!repoAccess.valid) {
        errors.push({ field: 'repository', message: repoAccess.error });
      }
    }

    // Validate resource limits
    if (config.limits) {
      if (config.limits.concurrentSessions > 50) {
        errors.push({ field: 'limits.concurrentSessions', message: 'Exceeds maximum allowed' });
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async listAll(): Promise<ClientConfig[]> {
    const result = await this.dynamoClient.send(
      new ScanCommand({
        TableName: 'webordinary-client-configs',
        FilterExpression: 'attribute_not_exists(deactivated)'
      })
    );

    return (result.Items || []).map(item => this.unmarshallConfig(item));
  }

  async getClientMetrics(clientId: string): Promise<ClientMetrics> {
    const [usage, performance, costs] = await Promise.all([
      this.getUsageMetrics(clientId),
      this.getPerformanceMetrics(clientId),
      this.getCostMetrics(clientId)
    ]);

    return { usage, performance, costs };
  }
}
```

### Phase 2: Advanced Configuration and Features (Week 2)

#### Day 1-2: Feature Flag System
```typescript
// New service: feature-flags/
export class FeatureFlagService {
  async isFeatureEnabled(clientId: string, feature: string): Promise<boolean> {
    const clientConfig = await this.clientConfigService.getConfig(clientId);
    if (!clientConfig) return false;

    // Check client-specific feature flags
    const clientFeatures = clientConfig.features || {};
    if (feature in clientFeatures) {
      return clientFeatures[feature];
    }

    // Check global feature flags
    const globalFlags = await this.getGlobalFeatureFlags();
    return globalFlags[feature]?.enabled || false;
  }

  async setClientFeature(clientId: string, feature: string, enabled: boolean): Promise<void> {
    await this.clientConfigService.updateConfig({
      clientId,
      features: {
        ...await this.getClientFeatures(clientId),
        [feature]: enabled
      }
    });

    // Notify containers of feature change
    await this.notifyContainersOfFeatureChange(clientId, feature, enabled);
  }

  async rolloutFeature(feature: string, rolloutPercentage: number): Promise<void> {
    const clients = await this.clientConfigService.listAll();
    const targetCount = Math.floor(clients.length * (rolloutPercentage / 100));
    
    // Randomly select clients for rollout
    const selectedClients = this.randomSample(clients, targetCount);
    
    for (const client of selectedClients) {
      await this.setClientFeature(client.clientId, feature, true);
    }
  }
}

// Usage in containers
export class ContainerFeatureManager {
  async checkFeature(feature: string): Promise<boolean> {
    const clientId = process.env.CLIENT_ID;
    return await this.featureFlagService.isFeatureEnabled(clientId, feature);
  }

  async conditionallyEnableFeature(feature: string, callback: () => Promise<void>): Promise<void> {
    if (await this.checkFeature(feature)) {
      await callback();
    }
  }
}
```

#### Day 3-4: Client Customization
```typescript
// Client customization service
export class ClientCustomizationService {
  async applyClientBranding(clientId: string, response: any): Promise<any> {
    const config = await this.clientConfigService.getConfig(clientId);
    if (!config?.customization?.branding) {
      return response;
    }

    const branding = config.customization.branding;
    
    // Inject custom CSS and branding
    if (response.headers?.['content-type']?.includes('text/html')) {
      response.body = this.injectBranding(response.body, branding);
    }

    return response;
  }

  private injectBranding(html: string, branding: BrandingConfig): string {
    let customizedHtml = html;

    if (branding.primaryColor) {
      customizedHtml = customizedHtml.replace(
        '<head>',
        `<head><style>:root { --primary-color: ${branding.primaryColor}; }</style>`
      );
    }

    if (branding.logo) {
      customizedHtml = customizedHtml.replace(
        /<img[^>]*class="logo"[^>]*>/g,
        `<img class="logo" src="${branding.logo}" alt="Logo">`
      );
    }

    return customizedHtml;
  }

  async getClientTheme(clientId: string): Promise<ThemeConfig> {
    const config = await this.clientConfigService.getConfig(clientId);
    return config?.customization?.ui || { theme: 'light' };
  }
}
```

#### Day 5: Usage Tracking and Billing
```typescript
// Usage tracking service
export class UsageTrackingService {
  async trackEditSession(clientId: string, sessionMetrics: SessionMetrics): Promise<void> {
    const usageData = {
      clientId,
      timestamp: Date.now(),
      sessionDuration: sessionMetrics.duration,
      apiCalls: sessionMetrics.apiCalls,
      dataTransfer: sessionMetrics.dataTransfer,
      computeTime: sessionMetrics.computeTime
    };

    // Store in time-series database (CloudWatch or TimestreamDB)
    await this.storeUsageData(usageData);
    
    // Update client usage counters
    await this.updateClientUsageCounters(clientId, usageData);
    
    // Check usage limits
    await this.checkUsageLimits(clientId);
  }

  async getClientUsage(clientId: string, timeRange: TimeRange): Promise<UsageSummary> {
    const usage = await this.queryUsageData(clientId, timeRange);
    
    return {
      editHours: usage.totalSessionDuration / (1000 * 60 * 60),
      apiCalls: usage.totalApiCalls,
      dataTransferGB: usage.totalDataTransfer / (1024 * 1024 * 1024),
      storageMB: await this.getStorageUsage(clientId),
      costs: await this.calculateCosts(clientId, usage)
    };
  }

  async generateBillingReport(clientId: string, month: string): Promise<BillingReport> {
    const config = await this.clientConfigService.getConfig(clientId);
    const usage = await this.getClientUsage(clientId, { month });
    
    return {
      clientId,
      period: month,
      plan: config.billing.plan,
      baseFee: config.billing.monthlyFee,
      usageCharges: this.calculateUsageCharges(usage, config.billing),
      totalAmount: config.billing.monthlyFee + this.calculateUsageCharges(usage, config.billing),
      usageDetails: usage
    };
  }
}
```

### Phase 3: Monitoring and Operations (Week 3)

#### Day 1-2: Client-Specific Monitoring
```typescript
// Monitoring service
export class ClientMonitoringService {
  async setupClientDashboard(clientId: string): Promise<void> {
    const dashboardConfig = {
      dashboardName: `Webordinary-Client-${clientId}`,
      widgets: [
        this.createContainerHealthWidget(clientId),
        this.createSessionMetricsWidget(clientId),
        this.createErrorRateWidget(clientId),
        this.createResourceUsageWidget(clientId),
        this.createCostTrackingWidget(clientId)
      ]
    };

    await this.cloudWatchClient.send(
      new PutDashboardCommand({ 
        DashboardName: dashboardConfig.dashboardName,
        DashboardBody: JSON.stringify(dashboardConfig)
      })
    );
  }

  async createClientAlarms(clientId: string): Promise<void> {
    const config = await this.clientConfigService.getConfig(clientId);
    
    // High error rate alarm
    await this.createAlarm({
      AlarmName: `${clientId}-high-error-rate`,
      MetricName: 'ErrorRate',
      Namespace: 'Webordinary/Client',
      Dimensions: [{ Name: 'ClientId', Value: clientId }],
      Statistic: 'Average',
      Period: 300,
      EvaluationPeriods: 2,
      Threshold: 5.0, // 5% error rate
      ComparisonOperator: 'GreaterThanThreshold',
      AlarmActions: [this.getClientNotificationTopic(clientId)]
    });

    // Container health alarm
    await this.createAlarm({
      AlarmName: `${clientId}-container-unhealthy`,
      MetricName: 'HealthyContainerCount',
      Namespace: 'Webordinary/Client',
      Dimensions: [{ Name: 'ClientId', Value: clientId }],
      Statistic: 'Average',
      Period: 60,
      EvaluationPeriods: 3,
      Threshold: 1,
      ComparisonOperator: 'LessThanThreshold'
    });

    // Usage limit alarms
    if (config.limits.monthlyEditHours > 0) {
      await this.createUsageLimitAlarm(clientId, 'EditHours', config.limits.monthlyEditHours);
    }
  }

  async getClientHealthStatus(clientId: string): Promise<ClientHealthStatus> {
    const [containers, sessions, errors, usage] = await Promise.all([
      this.getContainerHealth(clientId),
      this.getActiveSessionCount(clientId),
      this.getErrorRate(clientId),
      this.getCurrentUsage(clientId)
    ]);

    return {
      overall: this.calculateOverallHealth([containers, sessions, errors]),
      containers,
      sessions,
      errors,
      usage,
      lastUpdated: new Date()
    };
  }
}
```

#### Day 3-4: Operational Tools
```typescript
// Client operations service  
export class ClientOperationsService {
  async performHealthCheck(clientId: string): Promise<HealthCheckResult> {
    const results = await Promise.allSettled([
      this.checkDNSResolution(clientId),
      this.checkCertificateValidity(clientId),
      this.checkContainerHealth(clientId),
      this.checkRepositoryAccess(clientId),
      this.checkStorageHealth(clientId)
    ]);

    return {
      clientId,
      timestamp: new Date(),
      checks: results.map((result, index) => ({
        name: this.getCheckName(index),
        status: result.status === 'fulfilled' ? 'pass' : 'fail',
        details: result.status === 'fulfilled' ? result.value : result.reason?.message
      }))
    };
  }

  async migrateClient(clientId: string, newConfig: Partial<ClientConfig>): Promise<MigrationResult> {
    const migrationId = `migration-${clientId}-${Date.now()}`;
    
    try {
      // Create backup of current state
      const backup = await this.backupClientData(clientId);
      
      // Update configuration
      await this.clientConfigService.updateConfig({ clientId, ...newConfig });
      
      // Update infrastructure
      await this.updateClientInfrastructure(clientId, newConfig);
      
      // Restart containers with new configuration
      await this.restartClientContainers(clientId);
      
      // Verify migration success
      const healthCheck = await this.performHealthCheck(clientId);
      if (!healthCheck.checks.every(check => check.status === 'pass')) {
        throw new Error('Post-migration health check failed');
      }
      
      return { migrationId, status: 'success', backup };
      
    } catch (error) {
      // Rollback on failure
      await this.rollbackMigration(migrationId, clientId);
      throw error;
    }
  }

  async backupClientData(clientId: string): Promise<ClientBackup> {
    const [config, sessions, usage, storage] = await Promise.all([
      this.clientConfigService.getConfig(clientId),
      this.getClientSessions(clientId),
      this.getClientUsageHistory(clientId),
      this.backupClientStorage(clientId)
    ]);

    const backup = {
      clientId,
      timestamp: new Date(),
      config,
      sessions,
      usage,
      storageBackupId: storage.backupId
    };

    // Store backup metadata
    await this.storeBackupMetadata(backup);
    
    return backup;
  }
}
```

#### Day 5: Integration and Testing
- Integrate all new services with existing architecture
- Update session router to use enhanced client configuration
- Test client management workflows end-to-end
- Performance testing with multiple clients

## Success Criteria
- [ ] Client management dashboard functional
- [ ] Advanced client configuration options working
- [ ] Feature flag system operational
- [ ] Client customization (branding/themes) working
- [ ] Usage tracking and billing calculations accurate
- [ ] Client-specific monitoring dashboards created
- [ ] Operational tools (health checks, migrations) functional
- [ ] Comprehensive test coverage for all new features
- [ ] Performance benchmarks maintained with enhanced features

## Dependencies  
- **Task 24**: Multi-client foundation (prerequisite)
- **Infrastructure**: Enhanced CDK stacks
- **External**: CloudWatch, billing systems

## Risks and Mitigation
1. **Complexity**: Keep interfaces simple and well-documented
2. **Performance**: Monitor overhead of enhanced features
3. **Data Migration**: Careful handling of existing client data
4. **Feature Flags**: Avoid feature flag sprawl
5. **Billing Accuracy**: Thorough testing of usage calculations

## Out of Scope (Future Tasks)
- Automated client onboarding → **Task 26**
- Multi-region client deployment
- Advanced analytics and reporting
- Third-party integrations (Stripe, Slack, etc.)

## Deliverables
- Client management dashboard and API
- Enhanced client configuration schema and validation
- Feature flag system with gradual rollout capabilities  
- Client customization and branding system
- Usage tracking and billing calculation engine
- Client-specific monitoring and alerting setup
- Operational tools for client lifecycle management
- Comprehensive documentation for client management
- Migration guide from basic to enhanced client management