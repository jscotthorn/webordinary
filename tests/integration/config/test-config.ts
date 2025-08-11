export interface TestConfig {
  aws: {
    region: string;
    account: string;
    profile: string;
  };
  services: {
    clusterName: string;
    hermesService: string;
    editService: string;
    dynamoTableName: string;
  };
  endpoints: {
    alb: string;
    hermes: string;
    api: string;
  };
  timeouts: {
    containerReady: number;
    sessionExpiry: number;
    scaleDown: number;
    testTimeout: number;
  };
  testData: {
    clientId: string;
    repository: string;
    workspace: string;
    testPrefix: string;
  };
  resources: {
    efsFileSystemId: string;
    albListenerArn: string;
    vpcId?: string;
  };
}

export const TEST_CONFIG: TestConfig = {
  aws: {
    region: process.env.AWS_REGION || 'us-west-2',
    account: process.env.AWS_ACCOUNT_ID || '942734823970',
    profile: process.env.AWS_PROFILE || 'personal'
  },
  services: {
    clusterName: 'webordinary-edit-cluster',
    hermesService: 'webordinary-hermes-service',
    editService: 'webordinary-edit-service',
    dynamoTableName: 'webordinary-edit-sessions'
  },
  endpoints: {
    alb: process.env.ALB_ENDPOINT || 'https://webordinary-edit-alb-916355172.us-west-2.elb.amazonaws.com',
    hermes: process.env.HERMES_ENDPOINT || 'https://webordinary-edit-alb-916355172.us-west-2.elb.amazonaws.com/hermes',
    api: process.env.API_ENDPOINT || 'https://webordinary-edit-alb-916355172.us-west-2.elb.amazonaws.com/api'
  },
  timeouts: {
    containerReady: parseInt(process.env.CONTAINER_READY_TIMEOUT || '60000', 10), // 1 minute
    sessionExpiry: parseInt(process.env.SESSION_EXPIRY_TIMEOUT || '70000', 10), // 70 seconds (session TTL + buffer)
    scaleDown: parseInt(process.env.SCALE_DOWN_TIMEOUT || '30000', 10), // 30 seconds
    testTimeout: parseInt(process.env.TEST_TIMEOUT || '300000', 10) // 5 minutes
  },
  testData: {
    clientId: process.env.TEST_CLIENT_ID || 'integration-test-client',
    repository: 'webordinary-integration-tests',
    workspace: '/workspace/integration-test-client',
    testPrefix: 'TEST_'
  },
  resources: {
    efsFileSystemId: process.env.EFS_FILE_SYSTEM_ID || 'fs-0ab7a5e03c0dc5bfd',
    albListenerArn: process.env.ALB_LISTENER_ARN || 'arn:aws:elasticloadbalancing:us-west-2:942734823970:listener/app/webordinary-edit-alb/916355172/f8c5e5b1234567890',
    vpcId: process.env.VPC_ID
  }
};

export interface CreateSessionParams {
  clientId?: string;
  userId: string;
  instruction: string;
  metadata?: Record<string, any>;
}

export interface TestSession {
  sessionId: string;
  userId: string;
  clientId: string;
  threadId: string;
  status: 'initializing' | 'active' | 'expired' | 'error';
  previewUrl: string;
  lastActivity: number;
  ttl: number;
  containerId?: string; // Added for session resumption tests
  metadata?: Record<string, any>;
}

export interface TestResults {
  testId: string;
  testName: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  startTime: number;
  endTime: number;
  containerStartupTime?: number;
  sessionCreationTime?: number;
  autoShutdownTime?: number;
  cost?: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface TestReport {
  summary: {
    total: number;
    passed: number;
    failed: number;
    duration: number;
    timestamp: string;
  };
  performance: {
    coldStartLatency: {
      mean: number;
      p95: number;
      p99: number;
    };
    sessionCreationLatency: {
      mean: number;
      p95: number;
    };
    autoShutdownLatency: {
      mean: number;
      max: number;
    };
  };
  reliability: {
    successRate: number;
    errorDistribution: Record<string, number>;
    recoveryMetrics: {
      averageRecoveryTime: number;
      maxRecoveryTime: number;
    };
  };
  costs: {
    fargateComputeHours: number;
    dynamodbOperations: number;
    cloudwatchMetrics: number;
    estimatedTotalCost: number;
  };
}

/**
 * Validates the test configuration and environment
 */
export function validateTestConfig(): void {
  const required = [
    'AWS_REGION',
    'AWS_ACCOUNT_ID', 
    'ALB_ENDPOINT'
  ];

  const missing = required.filter(env => !process.env[env] && !getConfigValue(env));
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function getConfigValue(key: string): string | undefined {
  const configMap: Record<string, string> = {
    'AWS_REGION': TEST_CONFIG.aws.region,
    'AWS_ACCOUNT_ID': TEST_CONFIG.aws.account,
    'ALB_ENDPOINT': TEST_CONFIG.endpoints.alb
  };
  
  return configMap[key];
}