# Task 26: Automated Client Onboarding System

## Objective
Create a fully automated client onboarding system that transforms manual client setup into a self-service platform. This system will handle domain verification, infrastructure provisioning, repository integration, and deployment automation, enabling rapid client acquisition and reducing operational overhead.

## Background
Tasks 24 and 25 established a robust multi-client platform with advanced management capabilities. However, adding new clients still requires manual infrastructure provisioning, DNS setup, and configuration. This task creates an automated onboarding pipeline that can provision a new client from signup to production deployment in under 30 minutes.

## Requirements

### Self-Service Onboarding Portal
1. **Client Registration Interface**
   - Web-based signup form with domain verification
   - Repository connection and validation
   - Plan selection and billing setup
   - Terms of service and compliance checks

2. **Domain Verification System**
   - DNS verification for client domains
   - Automated SSL certificate provisioning
   - Domain ownership validation
   - Subdomain setup automation

### Infrastructure Automation
3. **Automated Resource Provisioning**
   - Route 53 hosted zone creation
   - ACM certificate request and validation
   - ALB target group and listener rules
   - ECS task definition generation
   - IAM roles and permissions setup

4. **Repository Integration Automation**
   - GitHub/GitLab repository access validation
   - Deploy key generation and installation
   - Initial repository analysis and compatibility check
   - Automated dependency resolution

### Deployment Pipeline
5. **Automated Deployment Process**
   - Container image building with client repository
   - Initial deployment and health verification
   - DNS propagation monitoring
   - End-to-end functionality testing

6. **Onboarding Workflow Orchestration**
   - Step-by-step progress tracking
   - Error handling and rollback capabilities
   - Notification system for progress updates
   - Support ticket integration for issues

## Implementation Plan

### Phase 1: Onboarding Portal and Domain Verification (Week 1)

#### Day 1-2: Registration Interface
```typescript
// New service: client-onboarding/
export class ClientOnboardingController {
  @Post('/register')
  async registerClient(@Body() registrationDto: ClientRegistrationDto): Promise<OnboardingSession> {
    // Validate registration data
    await this.validateRegistration(registrationDto);
    
    // Create onboarding session
    const onboardingId = `onboarding-${uuidv4()}`;
    const session: OnboardingSession = {
      onboardingId,
      clientId: registrationDto.clientId,
      status: 'domain_verification',
      steps: {
        registration: { status: 'completed', completedAt: new Date() },
        domainVerification: { status: 'in_progress', startedAt: new Date() },
        repositoryValidation: { status: 'pending' },
        infrastructureProvisioning: { status: 'pending' },
        deployment: { status: 'pending' },
        verification: { status: 'pending' }
      },
      config: registrationDto,
      createdAt: new Date()
    };

    // Store session
    await this.onboardingService.createSession(session);
    
    // Start domain verification process
    await this.domainVerificationService.initiateVerification(
      onboardingId, 
      registrationDto.domains
    );
    
    return session;
  }

  @Get('/onboarding/:onboardingId/status')
  async getOnboardingStatus(@Param('onboardingId') onboardingId: string): Promise<OnboardingStatus> {
    const session = await this.onboardingService.getSession(onboardingId);
    if (!session) {
      throw new NotFoundException('Onboarding session not found');
    }

    // Get real-time status of each step
    const currentStatus = await this.onboardingService.getCurrentStatus(onboardingId);
    
    return {
      onboardingId,
      clientId: session.clientId,
      overallProgress: this.calculateProgress(currentStatus.steps),
      currentStep: this.getCurrentStep(currentStatus.steps),
      steps: currentStatus.steps,
      estimatedTimeRemaining: this.estimateTimeRemaining(currentStatus.steps)
    };
  }
}

interface ClientRegistrationDto {
  clientId: string;
  companyName: string;
  contactEmail: string;
  domains: {
    production: string;    // "clientname.com"
    edit?: string;         // "edit.clientname.com" (optional, will be generated)
  };
  repository: {
    url: string;
    branch: string;
    accessToken?: string;  // For private repos
  };
  plan: 'starter' | 'professional' | 'enterprise';
  billing: {
    billingEmail: string;
    paymentMethodId?: string; // Stripe payment method
  };
}
```

#### Day 3-4: Domain Verification System
```typescript
// Domain verification service
export class DomainVerificationService {
  async initiateVerification(onboardingId: string, domains: DomainsConfig): Promise<void> {
    // Generate verification challenges
    const challenges = await this.generateVerificationChallenges(domains);
    
    // Store challenges
    await this.storeChallenges(onboardingId, challenges);
    
    // Send verification instructions to client
    await this.sendVerificationInstructions(onboardingId, challenges);
    
    // Start polling for verification
    await this.scheduleVerificationPolling(onboardingId);
  }

  private async generateVerificationChallenges(domains: DomainsConfig): Promise<VerificationChallenges> {
    const challenges: VerificationChallenges = {};
    
    for (const [type, domain] of Object.entries(domains)) {
      // Generate random verification token
      const token = this.generateSecureToken();
      
      challenges[domain] = {
        type: 'dns_txt',
        domain,
        recordName: `_webordinary-verification.${domain}`,
        recordValue: token,
        instructions: `Add this TXT record to ${domain}: _webordinary-verification IN TXT "${token}"`
      };
    }
    
    return challenges;
  }

  async verifyDomainOwnership(onboardingId: string): Promise<VerificationResult> {
    const challenges = await this.getChallenges(onboardingId);
    const results: DomainVerificationResult[] = [];
    
    for (const [domain, challenge] of Object.entries(challenges)) {
      const isValid = await this.checkDNSRecord(
        challenge.recordName, 
        challenge.recordValue
      );
      
      results.push({
        domain,
        verified: isValid,
        checkedAt: new Date()
      });
    }
    
    const allVerified = results.every(r => r.verified);
    
    if (allVerified) {
      // Update onboarding status
      await this.onboardingService.completeStep(onboardingId, 'domainVerification');
      
      // Start next step
      await this.repositoryValidationService.startValidation(onboardingId);
    }
    
    return { allVerified, results };
  }

  private async checkDNSRecord(recordName: string, expectedValue: string): Promise<boolean> {
    try {
      const records = await this.dnsResolver.resolveTxt(recordName);
      return records.some(record => record.join('').includes(expectedValue));
    } catch (error) {
      return false;
    }
  }
}
```

#### Day 5: Repository Validation
```typescript
// Repository validation service
export class RepositoryValidationService {
  async startValidation(onboardingId: string): Promise<void> {
    const session = await this.onboardingService.getSession(onboardingId);
    const repoConfig = session.config.repository;
    
    try {
      // Update status
      await this.onboardingService.updateStepStatus(onboardingId, 'repositoryValidation', {
        status: 'in_progress',
        startedAt: new Date()
      });

      // Validate repository access
      const accessResult = await this.validateRepositoryAccess(repoConfig);
      if (!accessResult.success) {
        throw new Error(`Repository access failed: ${accessResult.error}`);
      }

      // Analyze repository structure
      const analysisResult = await this.analyzeRepository(repoConfig);
      if (!analysisResult.compatible) {
        throw new Error(`Repository not compatible: ${analysisResult.issues.join(', ')}`);
      }

      // Generate deploy key for production access
      const deployKey = await this.generateDeployKey(onboardingId);
      await this.installDeployKey(repoConfig, deployKey);

      // Complete step
      await this.onboardingService.completeStep(onboardingId, 'repositoryValidation', {
        deployKeyId: deployKey.keyId,
        analysis: analysisResult
      });

      // Start infrastructure provisioning
      await this.infrastructureProvisioningService.startProvisioning(onboardingId);

    } catch (error) {
      await this.onboardingService.failStep(onboardingId, 'repositoryValidation', error.message);
    }
  }

  async analyzeRepository(repoConfig: RepositoryConfig): Promise<RepositoryAnalysis> {
    const repoContent = await this.fetchRepositoryContent(repoConfig);
    
    // Check for required files
    const hasPackageJson = repoContent.files.includes('package.json');
    const hasAstroConfig = repoContent.files.some(f => f.startsWith('astro.config'));
    
    // Analyze package.json for dependencies
    let dependencies = {};
    let scripts = {};
    if (hasPackageJson) {
      const packageJson = await this.fetchFile(repoConfig, 'package.json');
      dependencies = packageJson.dependencies || {};
      scripts = packageJson.scripts || {};
    }

    // Check Astro compatibility
    const isAstroProject = dependencies['astro'] || hasAstroConfig;
    const hasBuildScript = scripts['build'];
    
    const issues: string[] = [];
    if (!isAstroProject) {
      issues.push('Not an Astro project - missing astro dependency or config');
    }
    if (!hasBuildScript) {
      issues.push('Missing build script in package.json');
    }

    return {
      compatible: issues.length === 0,
      projectType: isAstroProject ? 'astro' : 'unknown',
      dependencies,
      scripts,
      files: repoContent.files,
      issues
    };
  }
}
```

### Phase 2: Infrastructure Automation (Week 2)

#### Day 1-3: Automated AWS Resource Provisioning
```typescript
// Infrastructure provisioning service
export class InfrastructureProvisioningService {
  async startProvisioning(onboardingId: string): Promise<void> {
    const session = await this.onboardingService.getSession(onboardingId);
    
    try {
      await this.onboardingService.updateStepStatus(onboardingId, 'infrastructureProvisioning', {
        status: 'in_progress',
        startedAt: new Date()
      });

      // Provision resources in parallel where possible
      const [hostedZone, certificate, targetGroup] = await Promise.all([
        this.createHostedZone(session.config.domains),
        this.requestCertificate(session.config.domains),
        this.createTargetGroup(session.clientId)
      ]);

      // Create ALB listener rules (depends on certificate)
      const listenerRules = await this.createListenerRules(session.clientId, session.config.domains, certificate.certificateArn);

      // Create ECS task definition
      const taskDefinition = await this.createTaskDefinition(session.clientId, session.config);

      // Create IAM roles
      const iamRoles = await this.createIAMRoles(session.clientId);

      // Store infrastructure details
      const infrastructure: ProvisionedInfrastructure = {
        hostedZoneId: hostedZone.hostedZoneId,
        certificateArn: certificate.certificateArn,
        targetGroupArn: targetGroup.targetGroupArn,
        taskDefinitionArn: taskDefinition.taskDefinitionArn,
        executionRoleArn: iamRoles.executionRoleArn,
        taskRoleArn: iamRoles.taskRoleArn
      };

      await this.onboardingService.completeStep(onboardingId, 'infrastructureProvisioning', {
        infrastructure
      });

      // Start deployment
      await this.deploymentService.startDeployment(onboardingId);

    } catch (error) {
      await this.onboardingService.failStep(onboardingId, 'infrastructureProvisioning', error.message);
      
      // Clean up any partially created resources
      await this.cleanupPartialInfrastructure(onboardingId);
    }
  }

  private async createHostedZone(domains: DomainsConfig): Promise<HostedZoneResult> {
    // Only create hosted zone for custom domains (not *.webordinary.com)
    if (domains.production.includes('webordinary.com')) {
      return { hostedZoneId: 'shared', nameServers: [] };
    }

    const command = new CreateHostedZoneCommand({
      Name: domains.production,
      CallerReference: `webordinary-${Date.now()}`,
      HostedZoneConfig: {
        Comment: `Webordinary client zone for ${domains.production}`,
        PrivateZone: false
      }
    });

    const response = await this.route53Client.send(command);
    
    return {
      hostedZoneId: response.HostedZone.Id,
      nameServers: response.DelegationSet?.NameServers || []
    };
  }

  private async requestCertificate(domains: DomainsConfig): Promise<CertificateResult> {
    const domainNames = [
      domains.production,
      domains.edit || `edit.${domains.production}`
    ];

    const command = new RequestCertificateCommand({
      DomainName: domains.production,
      SubjectAlternativeNames: domainNames.slice(1),
      ValidationMethod: 'DNS',
      KeyAlgorithm: 'RSA_2048'
    });

    const response = await this.acmClient.send(command);
    
    // Monitor certificate validation
    await this.monitorCertificateValidation(response.CertificateArn);
    
    return { certificateArn: response.CertificateArn };
  }

  private async createTaskDefinition(clientId: string, config: ClientRegistrationDto): Promise<TaskDefinitionResult> {
    const taskDef = new TaskDefinition(this.ecsStack, `${clientId}-TaskDef`, {
      family: `webordinary-${clientId}`,
      cpu: '512',
      memoryMiB: '1024',
      networkMode: NetworkMode.AWS_VPC,
      requiresCompatibilities: [Compatibility.FARGATE],
      executionRole: this.executionRole,
      taskRole: this.taskRole,
      containers: {
        [`${clientId}-container`]: {
          image: ContainerImage.fromRegistry('webordinary/client-container:latest'),
          portMappings: [{ containerPort: 8080 }],
          environment: {
            CLIENT_ID: clientId,
            REPOSITORY_URL: config.repository.url,
            REPOSITORY_BRANCH: config.repository.branch,
            DOMAIN_PRODUCTION: config.domains.production,
            DOMAIN_EDIT: config.domains.edit || `edit.${config.domains.production}`
          },
          logging: LogDrivers.awsLogs({
            streamPrefix: `webordinary-${clientId}`,
            logRetention: RetentionDays.ONE_MONTH
          })
        }
      }
    });

    return { taskDefinitionArn: taskDef.taskDefinitionArn };
  }
}
```

#### Day 4-5: Deployment Automation
```typescript
// Deployment service
export class DeploymentService {
  async startDeployment(onboardingId: string): Promise<void> {
    const session = await this.onboardingService.getSession(onboardingId);
    
    try {
      await this.onboardingService.updateStepStatus(onboardingId, 'deployment', {
        status: 'in_progress',
        startedAt: new Date()
      });

      // Build custom container image with client code
      const imageUri = await this.buildClientImage(session.clientId, session.config.repository);
      
      // Update task definition with custom image
      await this.updateTaskDefinitionImage(session.clientId, imageUri);
      
      // Start ECS service
      const service = await this.createECSService(session.clientId);
      
      // Wait for service to be stable
      await this.waitForServiceStability(service.serviceArn);
      
      // Register with target group
      await this.registerServiceWithTargetGroup(session.clientId, service.serviceArn);
      
      await this.onboardingService.completeStep(onboardingId, 'deployment', {
        serviceArn: service.serviceArn,
        imageUri
      });

      // Start verification
      await this.verificationService.startVerification(onboardingId);

    } catch (error) {
      await this.onboardingService.failStep(onboardingId, 'deployment', error.message);
    }
  }

  private async buildClientImage(clientId: string, repoConfig: RepositoryConfig): Promise<string> {
    // Create CodeBuild project for client
    const buildProject = new Project(this.codeBuildStack, `${clientId}-Build`, {
      projectName: `webordinary-${clientId}`,
      source: Source.gitHub({
        owner: this.extractRepoOwner(repoConfig.url),
        repo: this.extractRepoName(repoConfig.url),
        branch: repoConfig.branch,
        webhook: false
      }),
      environment: {
        buildImage: LinuxBuildImage.STANDARD_5_0,
        privileged: true // Required for Docker builds
      },
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              'echo Logging in to Amazon ECR...',
              'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com'
            ]
          },
          build: {
            commands: [
              'echo Building client container...',
              `docker build -t webordinary/${clientId}:latest .`,
              `docker tag webordinary/${clientId}:latest $IMAGE_REPO_URI:latest`
            ]
          },
          post_build: {
            commands: [
              'echo Pushing image to ECR...',
              'docker push $IMAGE_REPO_URI:latest'
            ]
          }
        }
      }),
      environmentVariables: {
        AWS_ACCOUNT_ID: { value: this.account },
        IMAGE_REPO_URI: { value: `${this.account}.dkr.ecr.${this.region}.amazonaws.com/webordinary-${clientId}` }
      }
    });

    // Trigger build
    const buildId = await this.triggerBuild(buildProject.projectName);
    
    // Wait for completion
    await this.waitForBuild(buildId);
    
    return `${this.account}.dkr.ecr.${this.region}.amazonaws.com/webordinary-${clientId}:latest`;
  }
}
```

### Phase 3: Verification and Go-Live (Week 3)

#### Day 1-2: End-to-End Verification
```typescript
// Verification service
export class VerificationService {
  async startVerification(onboardingId: string): Promise<void> {
    const session = await this.onboardingService.getSession(onboardingId);
    
    try {
      await this.onboardingService.updateStepStatus(onboardingId, 'verification', {
        status: 'in_progress',
        startedAt: new Date()
      });

      // Run comprehensive verification tests
      const verificationResults = await this.runVerificationSuite(session);
      
      if (verificationResults.allPassed) {
        // Create final client configuration
        const clientConfig = await this.createFinalClientConfig(session, verificationResults);
        
        // Store in client configuration service
        await this.clientConfigService.createConfig(clientConfig);
        
        // Send welcome email and setup instructions
        await this.sendWelcomeEmail(session.clientId, clientConfig);
        
        await this.onboardingService.completeStep(onboardingId, 'verification', {
          verificationResults,
          clientConfigId: clientConfig.clientId
        });
        
        // Mark onboarding as complete
        await this.onboardingService.completeOnboarding(onboardingId);
        
      } else {
        throw new Error(`Verification failed: ${verificationResults.failures.join(', ')}`);
      }

    } catch (error) {
      await this.onboardingService.failStep(onboardingId, 'verification', error.message);
    }
  }

  private async runVerificationSuite(session: OnboardingSession): Promise<VerificationResults> {
    const tests = [
      this.testDNSResolution(session.config.domains),
      this.testSSLCertificate(session.config.domains),
      this.testContainerDeployment(session.clientId),
      this.testWebInterface(session.config.domains.edit),
      this.testAPIEndpoints(session.clientId),
      this.testSessionManagement(session.clientId)
    ];

    const results = await Promise.allSettled(tests);
    const failures = results
      .filter((result, index) => result.status === 'rejected')
      .map((result, index) => `${this.getTestName(index)}: ${result.reason?.message}`);

    return {
      allPassed: failures.length === 0,
      testResults: results.map((result, index) => ({
        testName: this.getTestName(index),
        passed: result.status === 'fulfilled',
        details: result.status === 'fulfilled' ? result.value : result.reason?.message
      })),
      failures
    };
  }

  private async testWebInterface(editDomain: string): Promise<TestResult> {
    const testUrl = `https://${editDomain}/health`;
    
    try {
      const response = await fetch(testUrl, { timeout: 30000 });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const health = await response.json();
      if (health.status !== 'healthy') {
        throw new Error(`Service unhealthy: ${JSON.stringify(health)}`);
      }
      
      return { success: true, details: 'Web interface responding correctly' };
    } catch (error) {
      throw new Error(`Web interface test failed: ${error.message}`);
    }
  }
}
```

#### Day 3-4: Onboarding Workflow Orchestration
```typescript
// Onboarding orchestration service
export class OnboardingOrchestrationService {
  async processOnboardingSteps(onboardingId: string): Promise<void> {
    const session = await this.getSession(onboardingId);
    
    while (!this.isComplete(session) && !this.isFailed(session)) {
      const currentStep = this.getCurrentStep(session);
      
      try {
        await this.executeStep(onboardingId, currentStep);
        await this.sleep(5000); // Wait between steps
        session = await this.getSession(onboardingId);
      } catch (error) {
        await this.handleStepFailure(onboardingId, currentStep, error);
        break;
      }
    }
  }

  private async executeStep(onboardingId: string, step: OnboardingStep): Promise<void> {
    switch (step) {
      case 'domainVerification':
        await this.domainVerificationService.verifyDomainOwnership(onboardingId);
        break;
      case 'repositoryValidation':
        await this.repositoryValidationService.startValidation(onboardingId);
        break;
      case 'infrastructureProvisioning':
        await this.infrastructureProvisioningService.startProvisioning(onboardingId);
        break;
      case 'deployment':
        await this.deploymentService.startDeployment(onboardingId);
        break;
      case 'verification':
        await this.verificationService.startVerification(onboardingId);
        break;
    }
  }

  async rollbackOnboarding(onboardingId: string): Promise<void> {
    const session = await this.getSession(onboardingId);
    
    // Clean up in reverse order
    const cleanupSteps = [
      () => this.cleanupVerification(session),
      () => this.cleanupDeployment(session),
      () => this.cleanupInfrastructure(session),
      () => this.cleanupRepository(session),
      () => this.cleanupDomainVerification(session)
    ];

    for (const cleanup of cleanupSteps) {
      try {
        await cleanup();
      } catch (error) {
        console.error('Cleanup error:', error);
        // Continue with other cleanup steps
      }
    }

    await this.updateSessionStatus(onboardingId, 'rolled_back');
  }
}
```

#### Day 5: Integration Testing and Go-Live
```typescript
// Integration tests for onboarding system
describe('Automated Client Onboarding', () => {
  it('should complete full onboarding flow', async () => {
    const testRegistration: ClientRegistrationDto = {
      clientId: 'test-client-' + Date.now(),
      companyName: 'Test Company',
      contactEmail: 'test@example.com',
      domains: {
        production: 'testclient.webordinary.com',
        edit: 'edit.testclient.webordinary.com'
      },
      repository: {
        url: 'https://github.com/webordinary/test-astro-site',
        branch: 'main'
      },
      plan: 'starter',
      billing: {
        billingEmail: 'billing@example.com'
      }
    };

    // Start onboarding
    const onboardingSession = await onboardingController.registerClient(testRegistration);
    expect(onboardingSession.status).toBe('domain_verification');

    // Mock domain verification
    await mockDomainVerification(onboardingSession.onboardingId);

    // Wait for completion
    const finalStatus = await waitForOnboardingCompletion(onboardingSession.onboardingId, 30 * 60 * 1000); // 30 minutes
    expect(finalStatus.status).toBe('completed');

    // Verify client is operational
    const healthCheck = await clientOperationsService.performHealthCheck(testRegistration.clientId);
    expect(healthCheck.checks.every(check => check.status === 'pass')).toBe(true);
  });
});
```

## Success Criteria
- [ ] Self-service registration portal functional
- [ ] Domain verification automation working
- [ ] Infrastructure provisioning fully automated
- [ ] Repository integration and validation working
- [ ] Container build and deployment automated
- [ ] End-to-end verification comprehensive
- [ ] Onboarding completes in under 30 minutes
- [ ] Rollback and error handling robust
- [ ] 95% onboarding success rate for valid inputs
- [ ] Integration with existing client management system

## Dependencies
- **Tasks 24 & 25**: Multi-client foundation and management (prerequisites)
- **Infrastructure**: CodeBuild, ECR, advanced CDK stacks
- **External**: GitHub/GitLab APIs, DNS providers, Stripe billing

## Risks and Mitigation
1. **DNS Propagation**: Allow sufficient time and provide clear instructions
2. **Certificate Validation**: Monitor ACM validation status closely
3. **Repository Access**: Provide clear instructions for deploy key installation
4. **Resource Quotas**: Monitor AWS service quotas and request increases
5. **Build Failures**: Comprehensive error handling and rollback

## Out of Scope (Future Enhancements)
- Advanced repository analysis and migration tools
- Multi-cloud deployment options
- Advanced billing integration (Stripe Connect)
- White-label onboarding portals
- Enterprise SSO integration

## Deliverables
- Self-service client registration portal
- Automated domain verification system
- Infrastructure provisioning automation
- Repository integration and validation system
- Automated deployment pipeline
- End-to-end verification and testing framework
- Onboarding workflow orchestration engine
- Comprehensive error handling and rollback system
- Integration tests for complete onboarding flow
- Client documentation for self-service onboarding
- Operational dashboard for onboarding monitoring

## Success Metrics
- **Onboarding Time**: Average < 30 minutes for standard configurations
- **Success Rate**: >95% for valid client configurations
- **Support Tickets**: <5% of onboardings require manual intervention
- **Time to Value**: Clients can edit their site within 1 hour of signup
- **Operational Efficiency**: 10x reduction in manual onboarding effort