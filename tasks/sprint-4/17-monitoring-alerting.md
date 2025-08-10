# Task 17: CloudWatch Monitoring and Alerting Setup

## Objective
Implement comprehensive monitoring and alerting for the multi-session SQS architecture to ensure system health and rapid issue detection.

## Monitoring Components

### 1. Queue Metrics
- Message count per queue
- Message age (oldest message)
- DLQ message count (critical alert)
- Queue processing rate
- Message failures and retries

### 2. Container Metrics
- Active container count
- Sessions per container
- Container CPU/memory usage
- Container startup time
- Idle containers

### 3. Session Metrics
- Active sessions
- Session duration
- Commands per session
- Interrupt frequency
- Session errors

## CloudWatch Dashboard

```typescript
// hephaestus/lib/monitoring-stack.ts
export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Create main dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'WebordinaryDashboard', {
      dashboardName: 'webordinary-edit-sessions',
      widgets: [
        [this.createQueueMetricsWidget()],
        [this.createContainerMetricsWidget()],
        [this.createSessionMetricsWidget()],
        [this.createErrorRateWidget()]
      ]
    });
    
    // Create alarms
    this.createQueueAlarms();
    this.createContainerAlarms();
    this.createSessionAlarms();
  }
  
  private createQueueMetricsWidget() {
    return new cloudwatch.GraphWidget({
      title: 'SQS Queue Metrics',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/SQS',
          metricName: 'ApproximateNumberOfMessagesVisible',
          dimensionsMap: { QueueName: 'webordinary-input-*' },
          statistic: 'Average',
          label: 'Input Queue Depth'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/SQS',
          metricName: 'ApproximateAgeOfOldestMessage',
          dimensionsMap: { QueueName: 'webordinary-input-*' },
          statistic: 'Maximum',
          label: 'Oldest Message Age'
        })
      ],
      right: [
        new cloudwatch.Metric({
          namespace: 'AWS/SQS',
          metricName: 'NumberOfMessagesReceived',
          dimensionsMap: { QueueName: 'webordinary-input-*' },
          statistic: 'Sum',
          label: 'Messages Processed'
        })
      ]
    });
  }
  
  private createContainerMetricsWidget() {
    return new cloudwatch.GraphWidget({
      title: 'Container Metrics',
      left: [
        new cloudwatch.Metric({
          namespace: 'ECS/ContainerInsights',
          metricName: 'RunningTaskCount',
          dimensionsMap: {
            ServiceName: 'webordinary-edit-service',
            ClusterName: 'webordinary-edit-cluster'
          },
          statistic: 'Average',
          label: 'Active Containers'
        })
      ],
      right: [
        new cloudwatch.Metric({
          namespace: 'ECS/ContainerInsights',
          metricName: 'CpuUtilized',
          dimensionsMap: {
            ServiceName: 'webordinary-edit-service',
            ClusterName: 'webordinary-edit-cluster'
          },
          statistic: 'Average',
          label: 'CPU Usage %'
        })
      ]
    });
  }
  
  private createQueueAlarms() {
    // DLQ alarm - critical
    new cloudwatch.Alarm(this, 'DLQMessagesAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfMessagesVisible',
        dimensionsMap: { QueueName: 'webordinary-dlq-*' }
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Messages in DLQ indicate processing failures'
    });
    
    // Message age alarm - warning
    new cloudwatch.Alarm(this, 'MessageAgeAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateAgeOfOldestMessage',
        dimensionsMap: { QueueName: 'webordinary-input-*' }
      }),
      threshold: 300, // 5 minutes
      evaluationPeriods: 2,
      alarmDescription: 'Messages taking too long to process'
    });
    
    // Queue depth alarm
    new cloudwatch.Alarm(this, 'QueueDepthAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfMessagesVisible',
        dimensionsMap: { QueueName: 'webordinary-input-*' }
      }),
      threshold: 100,
      evaluationPeriods: 2,
      alarmDescription: 'Queue backlog building up'
    });
  }
}
```

## Custom Metrics

```typescript
// hermes/src/modules/monitoring/metrics.service.ts
@Injectable()
export class MetricsService {
  private readonly cloudWatch: CloudWatchClient;
  
  async recordSessionMetric(
    metricName: string,
    value: number,
    unit: Unit = 'Count',
    dimensions?: Record<string, string>
  ) {
    const params: PutMetricDataCommandInput = {
      Namespace: 'Webordinary/EditSessions',
      MetricData: [{
        MetricName: metricName,
        Value: value,
        Unit: unit,
        Timestamp: new Date(),
        Dimensions: Object.entries(dimensions || {}).map(([Name, Value]) => ({
          Name,
          Value
        }))
      }]
    };
    
    await this.cloudWatch.send(new PutMetricDataCommand(params));
  }
  
  async recordSessionCreated(clientId: string, source: string) {
    await this.recordSessionMetric('SessionsCreated', 1, 'Count', {
      ClientId: clientId,
      Source: source
    });
  }
  
  async recordCommandProcessed(
    sessionId: string,
    duration: number,
    success: boolean
  ) {
    await this.recordSessionMetric(
      'CommandDuration',
      duration,
      'Milliseconds',
      { SessionId: sessionId }
    );
    
    await this.recordSessionMetric(
      success ? 'CommandSuccess' : 'CommandFailure',
      1,
      'Count',
      { SessionId: sessionId }
    );
  }
  
  async recordInterrupt(fromSession: string, toSession: string) {
    await this.recordSessionMetric('SessionInterrupts', 1, 'Count', {
      FromSession: fromSession,
      ToSession: toSession
    });
  }
  
  async recordContainerStartup(containerId: string, startupTime: number) {
    await this.recordSessionMetric(
      'ContainerStartupTime',
      startupTime,
      'Milliseconds',
      { ContainerId: containerId }
    );
  }
}
```

## Log Aggregation

```typescript
// Container logging configuration
const logGroup = new logs.LogGroup(this, 'EditContainerLogs', {
  logGroupName: '/ecs/webordinary/edit',
  retention: logs.RetentionDays.ONE_WEEK
});

// Log insights queries
const queries = {
  errors: `
    fields @timestamp, @message
    | filter @message like /ERROR/
    | sort @timestamp desc
    | limit 100
  `,
  
  interrupts: `
    fields @timestamp, sessionId, message
    | filter @message like /Interrupting session/
    | stats count() as interrupts by bin(5m)
  `,
  
  performance: `
    fields @timestamp, duration, sessionId
    | filter @message like /Command completed/
    | stats avg(duration) as avg_duration,
            max(duration) as max_duration,
            min(duration) as min_duration
    by bin(5m)
  `,
  
  sessions: `
    fields @timestamp, sessionId, containerId
    | filter @message like /Session (created|closed)/
    | stats count() as session_events by bin(1h)
  `
};
```

## SNS Alerting

```typescript
// hephaestus/lib/alerting-stack.ts
export class AlertingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Create SNS topic for alerts
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'webordinary-edit-alerts',
      displayName: 'Webordinary Edit Session Alerts'
    });
    
    // Add email subscriptions
    alertTopic.addSubscription(
      new subscriptions.EmailSubscription('ops-team@webordinary.com')
    );
    
    // Create alert levels
    const criticalTopic = new sns.Topic(this, 'CriticalAlertTopic', {
      topicName: 'webordinary-critical-alerts'
    });
    
    criticalTopic.addSubscription(
      new subscriptions.SmsSubscription('+1234567890') // On-call phone
    );
    
    // Connect alarms to topics
    this.connectAlarmsToTopics(alertTopic, criticalTopic);
  }
  
  private connectAlarmsToTopics(
    alertTopic: sns.Topic,
    criticalTopic: sns.Topic
  ) {
    // Critical alarms → SMS + Email
    const dlqAlarm = cloudwatch.Alarm.fromAlarmArn(
      this,
      'ImportedDLQAlarm',
      'arn:aws:cloudwatch:...'
    );
    dlqAlarm.addAlarmAction(new actions.SnsAction(criticalTopic));
    
    // Warning alarms → Email only
    const queueDepthAlarm = cloudwatch.Alarm.fromAlarmArn(
      this,
      'ImportedQueueDepthAlarm',
      'arn:aws:cloudwatch:...'
    );
    queueDepthAlarm.addAlarmAction(new actions.SnsAction(alertTopic));
  }
}
```

## Health Check Endpoint

```typescript
// hermes/src/modules/health/health.controller.ts
@Controller('health')
export class HealthController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly sqsService: SqsManagerService,
    private readonly containerService: ContainerManagerService
  ) {}
  
  @Get()
  async getHealth(): Promise<HealthStatus> {
    const checks = await Promise.all([
      this.checkQueues(),
      this.checkContainers(),
      this.checkDynamoDB(),
      this.checkSQS()
    ]);
    
    const status = checks.every(c => c.healthy) ? 'healthy' : 'unhealthy';
    
    return {
      status,
      timestamp: new Date().toISOString(),
      checks
    };
  }
  
  private async checkQueues(): Promise<HealthCheck> {
    try {
      const queueStats = await this.sqsService.getQueueStatistics();
      
      return {
        name: 'sqs_queues',
        healthy: queueStats.dlqMessages === 0,
        message: `${queueStats.activeQueues} active queues, ${queueStats.dlqMessages} DLQ messages`,
        metrics: {
          activeQueues: queueStats.activeQueues,
          dlqMessages: queueStats.dlqMessages,
          oldestMessage: queueStats.oldestMessageAge
        }
      };
    } catch (error) {
      return {
        name: 'sqs_queues',
        healthy: false,
        message: error.message
      };
    }
  }
  
  private async checkContainers(): Promise<HealthCheck> {
    try {
      const containerStats = await this.containerService.getStatistics();
      
      return {
        name: 'containers',
        healthy: true,
        message: `${containerStats.running} running, ${containerStats.idle} idle`,
        metrics: {
          running: containerStats.running,
          idle: containerStats.idle,
          totalSessions: containerStats.totalSessions
        }
      };
    } catch (error) {
      return {
        name: 'containers',
        healthy: false,
        message: error.message
      };
    }
  }
}
```

## Success Criteria
- [ ] CloudWatch dashboard shows all key metrics
- [ ] Alarms trigger for critical conditions
- [ ] SNS notifications work for alerts
- [ ] Log aggregation provides insights
- [ ] Custom metrics track business KPIs
- [ ] Health endpoint provides system status

## Testing
- Simulate queue failures to test DLQ alarm
- Create message backlog to test queue depth alarm
- Force container failures to test container alarms
- Verify alert notifications arrive
- Test dashboard under load conditions