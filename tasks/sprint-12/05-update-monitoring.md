# Task 05: Update Monitoring

## Objective
Update CloudWatch dashboards and alarms to reflect the new S3 architecture, removing obsolete metrics and adding new ones.

## Context
Current monitoring includes:
- Lambda function metrics (obsolete)
- ALB target health metrics (obsolete)
- Container web serving metrics (obsolete)

Need to add:
- S3 sync success/failure metrics
- Build completion metrics
- Git operation metrics
- Container lifecycle metrics (without web health)

## Implementation Steps

### 1. Update Monitoring Stack - Remove Obsolete Widgets

```typescript
// lib/monitoring-stack.ts

export class MonitoringStack extends cdk.Stack {
  // ... existing code ...

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ... SNS topics setup ...

    // Updated dashboard with S3 architecture metrics
    this.dashboard = new cloudwatch.Dashboard(this, 'ComprehensiveDashboard', {
      dashboardName: 'webordinary-s3-monitoring',
      widgets: [
        [this.createSQSMetricsWidget()],
        [this.createContainerMetricsWidget(), this.createS3MetricsWidget()],
        [this.createDynamoDBMetricsWidget(), this.createBuildMetricsWidget()],
        [this.createErrorRatesWidget(), this.createGitMetricsWidget()]
      ]
    });

    // Updated alarms
    this.createSQSAlarms();
    this.createContainerAlarms();
    this.createDynamoDBAlarms();
    this.createS3Alarms(); // NEW
    this.createBuildAlarms(); // NEW
    // REMOVED: this.createLambdaAlarms();
    // REMOVED: this.createALBAlarms();
  }

  // REMOVED: Lambda metrics widget
  // private createLambdaMetricsWidget(): cloudwatch.GraphWidget { ... }

  // NEW: S3 metrics widget
  private createS3MetricsWidget(): cloudwatch.GraphWidget {
    return new cloudwatch.GraphWidget({
      title: 'S3 Deployment Metrics',
      left: [
        new cloudwatch.Metric({
          namespace: 'WebOrdinary/Deployments',
          metricName: 'S3SyncSuccess',
          statistic: 'Sum',
          label: 'Successful Syncs',
        }),
        new cloudwatch.Metric({
          namespace: 'WebOrdinary/Deployments',
          metricName: 'S3SyncFailure',
          statistic: 'Sum',
          label: 'Failed Syncs',
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: 'WebOrdinary/Deployments',
          metricName: 'S3SyncDuration',
          statistic: 'Average',
          label: 'Sync Duration (ms)',
        }),
        new cloudwatch.Metric({
          namespace: 'WebOrdinary/Deployments',
          metricName: 'S3ObjectsUploaded',
          statistic: 'Sum',
          label: 'Objects Uploaded',
        }),
      ],
      period: cdk.Duration.minutes(5),
      statistic: 'Average',
      width: 12,
      height: 6,
    });
  }

  // NEW: Build metrics widget
  private createBuildMetricsWidget(): cloudwatch.GraphWidget {
    return new cloudwatch.GraphWidget({
      title: 'Astro Build Metrics',
      left: [
        new cloudwatch.Metric({
          namespace: 'WebOrdinary/Builds',
          metricName: 'BuildSuccess',
          statistic: 'Sum',
          label: 'Successful Builds',
        }),
        new cloudwatch.Metric({
          namespace: 'WebOrdinary/Builds',
          metricName: 'BuildFailure',
          statistic: 'Sum',
          label: 'Failed Builds',
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: 'WebOrdinary/Builds',
          metricName: 'BuildDuration',
          statistic: 'Average',
          label: 'Build Duration (ms)',
        }),
      ],
      period: cdk.Duration.minutes(5),
      width: 12,
      height: 6,
    });
  }

  // NEW: Git metrics widget
  private createGitMetricsWidget(): cloudwatch.GraphWidget {
    return new cloudwatch.GraphWidget({
      title: 'Git Operations',
      left: [
        new cloudwatch.Metric({
          namespace: 'WebOrdinary/Git',
          metricName: 'CommitSuccess',
          statistic: 'Sum',
          label: 'Commits',
        }),
        new cloudwatch.Metric({
          namespace: 'WebOrdinary/Git',
          metricName: 'PushSuccess',
          statistic: 'Sum',
          label: 'Pushes',
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: 'WebOrdinary/Git',
          metricName: 'BranchesCreated',
          statistic: 'Sum',
          label: 'Branches Created',
        }),
      ],
      period: cdk.Duration.minutes(5),
      width: 12,
      height: 6,
    });
  }

  // Updated container metrics (no web health)
  private createContainerMetricsWidget(): cloudwatch.GraphWidget {
    return new cloudwatch.GraphWidget({
      title: 'Container Processing Metrics',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/ECS',
          metricName: 'CPUUtilization',
          dimensionsMap: {
            ServiceName: 'webordinary-edit-service',
            ClusterName: 'webordinary-edit-cluster',
          },
          statistic: 'Average',
          label: 'CPU %',
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/ECS',
          metricName: 'MemoryUtilization',
          dimensionsMap: {
            ServiceName: 'webordinary-edit-service',
            ClusterName: 'webordinary-edit-cluster',
          },
          statistic: 'Average',
          label: 'Memory %',
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: 'WebOrdinary/Containers',
          metricName: 'MessagesProcessed',
          statistic: 'Sum',
          label: 'Messages Processed',
        }),
        new cloudwatch.Metric({
          namespace: 'WebOrdinary/Containers',
          metricName: 'ProcessingDuration',
          statistic: 'Average',
          label: 'Processing Time (ms)',
        }),
      ],
      period: cdk.Duration.minutes(5),
      width: 12,
      height: 6,
    });
  }
}
```

### 2. Create New Alarms

```typescript
// lib/monitoring-stack.ts

private createS3Alarms(): void {
  // S3 sync failure alarm
  new cloudwatch.Alarm(this, 'S3SyncFailureAlarm', {
    metric: new cloudwatch.Metric({
      namespace: 'WebOrdinary/Deployments',
      metricName: 'S3SyncFailure',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    }),
    threshold: 3,
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    alarmDescription: 'S3 sync failures detected',
  }).addAlarmAction(new actions.SnsAction(this.alertTopic));

  // S3 sync duration alarm
  new cloudwatch.Alarm(this, 'S3SyncDurationAlarm', {
    metric: new cloudwatch.Metric({
      namespace: 'WebOrdinary/Deployments',
      metricName: 'S3SyncDuration',
      statistic: 'Average',
      period: cdk.Duration.minutes(10),
    }),
    threshold: 60000, // 1 minute
    evaluationPeriods: 2,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    alarmDescription: 'S3 sync taking too long',
  }).addAlarmAction(new actions.SnsAction(this.alertTopic));
}

private createBuildAlarms(): void {
  // Build failure rate alarm
  new cloudwatch.Alarm(this, 'BuildFailureRateAlarm', {
    metric: new cloudwatch.MathExpression({
      expression: '(failures / (failures + successes)) * 100',
      usingMetrics: {
        failures: new cloudwatch.Metric({
          namespace: 'WebOrdinary/Builds',
          metricName: 'BuildFailure',
          statistic: 'Sum',
        }),
        successes: new cloudwatch.Metric({
          namespace: 'WebOrdinary/Builds',
          metricName: 'BuildSuccess',
          statistic: 'Sum',
        }),
      },
      period: cdk.Duration.minutes(30),
    }),
    threshold: 25, // 25% failure rate
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    alarmDescription: 'High build failure rate',
  }).addAlarmAction(new actions.SnsAction(this.criticalTopic));
}
```

### 3. Add Custom Metrics in Container

Update container code to publish custom metrics:

```typescript
// Example code to add to container (message-processor.service.ts)

import { CloudWatch } from '@aws-sdk/client-cloudwatch';

const cloudwatch = new CloudWatch({ region: process.env.AWS_REGION });

// After successful S3 sync
await cloudwatch.putMetricData({
  Namespace: 'WebOrdinary/Deployments',
  MetricData: [
    {
      MetricName: 'S3SyncSuccess',
      Value: 1,
      Unit: 'Count',
      Timestamp: new Date(),
      Dimensions: [
        { Name: 'ClientId', Value: clientId },
      ],
    },
    {
      MetricName: 'S3SyncDuration',
      Value: syncDurationMs,
      Unit: 'Milliseconds',
      Timestamp: new Date(),
    },
    {
      MetricName: 'S3ObjectsUploaded',
      Value: objectCount,
      Unit: 'Count',
      Timestamp: new Date(),
    },
  ],
});

// After build completion
await cloudwatch.putMetricData({
  Namespace: 'WebOrdinary/Builds',
  MetricData: [
    {
      MetricName: buildSuccess ? 'BuildSuccess' : 'BuildFailure',
      Value: 1,
      Unit: 'Count',
      Timestamp: new Date(),
    },
    {
      MetricName: 'BuildDuration',
      Value: buildDurationMs,
      Unit: 'Milliseconds',
      Timestamp: new Date(),
    },
  ],
});
```

### 4. Clean Up Old Alarms

```bash
# List all alarms
aws cloudwatch describe-alarms \
  --alarm-name-prefix "webordinary" \
  --profile personal \
  --query "MetricAlarms[].AlarmName"

# Delete obsolete alarms
aws cloudwatch delete-alarms \
  --alarm-names \
    "webordinary-lambda-errors" \
    "webordinary-alb-unhealthy-targets" \
    "webordinary-target-response-time" \
  --profile personal
```

### 5. Deployment

```bash
# Build and deploy monitoring stack
cd hephaestus
npm run build
npx cdk deploy MonitoringStack --profile personal

# Verify dashboard
echo "Dashboard URL: https://console.aws.amazon.com/cloudwatch/home?region=us-west-2#dashboards:name=webordinary-s3-monitoring"
```

### 6. Test Metric Publishing

```bash
# Trigger a build and S3 sync
# Then check if metrics appear

aws cloudwatch get-metric-statistics \
  --namespace WebOrdinary/Deployments \
  --metric-name S3SyncSuccess \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-12-31T23:59:59Z \
  --period 3600 \
  --statistics Sum \
  --profile personal
```

## Updated Monitoring Coverage

### What We Monitor Now
- **SQS**: Queue depth, message age, processing rate
- **Containers**: CPU, memory, message processing
- **S3**: Sync success/failure, duration, object count
- **Builds**: Success/failure, duration
- **Git**: Commits, pushes, branches
- **DynamoDB**: Read/write capacity, throttles

### What We No Longer Monitor
- **Lambda**: Function errors, duration, throttles
- **ALB**: Target health, response times, error rates
- **Container Health**: HTTP health checks, port availability

## Acceptance Criteria

- [ ] Lambda metrics removed from dashboard
- [ ] ALB metrics removed from dashboard
- [ ] S3 metrics widget added
- [ ] Build metrics widget added
- [ ] Git metrics widget added
- [ ] New alarms configured
- [ ] Old alarms deleted
- [ ] Container publishes custom metrics
- [ ] Dashboard accessible and working

## Time Estimate
2-3 hours

## Notes
- Custom metrics incur additional CloudWatch costs
- Consider metric filters on logs as alternative
- Set up metric math expressions for calculated values
- Review alarm thresholds after collecting baseline data