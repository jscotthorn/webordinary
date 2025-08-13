# WebOrdinary Architecture Diagrams

## System Overview - S3 Architecture (Current)

```mermaid
graph TB
    subgraph "User Layer"
        U[User Email Client]
    end
    
    subgraph "AWS Edge"
        SES[AWS SES]
        CF[CloudFront CDN]
        R53[Route53 DNS]
    end
    
    subgraph "Message Layer"
        EQ[Email Queue]
        UQ[Unclaimed Queue]
        PQ[Project Queues]
        OQ[Output Queues]
        DLQ[Dead Letter Queue]
    end
    
    subgraph "Processing Layer"
        H[Hermes Service]
        CC[Claude Containers]
    end
    
    subgraph "Storage Layer"
        DDB[(DynamoDB)]
        S3[S3 Static Sites]
        EFS[EFS Workspaces]
    end
    
    subgraph "Repository"
        GH[GitHub/CodeCommit]
    end
    
    U -->|Email| SES
    SES --> EQ
    EQ --> H
    H --> PQ
    H --> UQ
    H --> DDB
    
    UQ --> CC
    PQ --> CC
    CC --> OQ
    CC --> S3
    CC --> EFS
    CC --> GH
    
    S3 --> CF
    CF --> R53
    R53 -->|HTTPS| U
    
    style S3 fill:#90EE90
    style CC fill:#87CEEB
    style H fill:#FFB6C1
```

## Message Flow Detail

```mermaid
sequenceDiagram
    participant User
    participant SES
    participant EmailQueue
    participant Hermes
    participant DynamoDB
    participant UnclaimedQueue
    participant Container
    participant S3
    participant GitHub
    
    User->>SES: Send email to buddy@webordinary.com
    SES->>EmailQueue: Queue message
    EmailQueue->>Hermes: Poll message
    Hermes->>Hermes: Parse email & extract thread ID
    Hermes->>DynamoDB: Check thread mapping
    Hermes->>DynamoDB: Check container ownership
    
    alt No active container
        Hermes->>UnclaimedQueue: Send claim request
        UnclaimedQueue->>Container: Claim project+user
        Container->>DynamoDB: Register ownership
    end
    
    Hermes->>Container: Route to project queue
    Container->>Container: Process with Claude
    Container->>GitHub: Clone/pull repository
    Container->>Container: Build Astro site
    Container->>S3: Deploy static files
    Container->>GitHub: Commit & push changes
    Container->>Hermes: Send response
    
    S3-->>User: Site accessible via CloudFront
```

## Container Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Cold: Container starts
    Cold --> Warming: Receive unclaimed message
    Warming --> Claimed: Claim project+user
    Claimed --> Processing: Receive instruction
    Processing --> Building: Execute Claude Code
    Building --> Deploying: Build Astro
    Deploying --> Syncing: Sync to S3
    Syncing --> Committing: Git operations
    Committing --> Ready: Complete
    Ready --> Processing: New instruction
    Ready --> Idle: No messages (5 min)
    Idle --> Sleeping: No messages (20 min)
    Sleeping --> [*]: Scale down
    
    Processing --> Interrupted: Interrupt signal
    Interrupted --> Processing: Resume
```

## Project+User Ownership Model

```mermaid
graph LR
    subgraph "Projects"
        P1[amelia]
        P2[test]
        P3[demo]
    end
    
    subgraph "Users"
        U1[scott]
        U2[alice]
        U3[bob]
    end
    
    subgraph "Containers"
        C1[Container-1]
        C2[Container-2]
        C3[Container-3]
    end
    
    subgraph "Claims"
        CL1[amelia+scott]
        CL2[amelia+alice]
        CL3[test+scott]
        CL4[demo+bob]
    end
    
    P1 --> CL1
    U1 --> CL1
    CL1 --> C1
    
    P1 --> CL2
    U2 --> CL2
    CL2 --> C2
    
    P2 --> CL3
    U1 --> CL3
    CL3 --> C1
    
    P3 --> CL4
    U3 --> CL4
    CL4 --> C3
    
    style C1 fill:#90EE90
    style C2 fill:#87CEEB
    style C3 fill:#FFB6C1
```

## Git Branch Strategy

```mermaid
gitGraph
    commit id: "main"
    branch thread-abc123
    checkout thread-abc123
    commit id: "User: Create homepage"
    commit id: "User: Add navigation"
    checkout main
    branch thread-def456
    checkout thread-def456
    commit id: "User: Update styles"
    checkout thread-abc123
    commit id: "User: Add footer"
    checkout main
    merge thread-abc123
    checkout thread-def456
    commit id: "User: Fix responsive"
    checkout main
    merge thread-def456
```

## Infrastructure Stack

```mermaid
graph TB
    subgraph "VPC"
        subgraph "Private Subnet 1"
            ECS1[ECS Tasks]
            EFS1[EFS Mount]
        end
        
        subgraph "Private Subnet 2"
            ECS2[ECS Tasks]
            EFS2[EFS Mount]
        end
        
        NAT[NAT Gateway]
    end
    
    subgraph "Public Services"
        IGW[Internet Gateway]
        ALB[ALB - Health Only]
    end
    
    subgraph "Storage"
        S3B[S3 Buckets]
        DYNB[DynamoDB]
        ECR[ECR Repos]
    end
    
    subgraph "Queuing"
        SQS[SQS Queues]
    end
    
    ECS1 --> NAT
    ECS2 --> NAT
    NAT --> IGW
    ALB --> ECS1
    ALB --> ECS2
    
    ECS1 --> S3B
    ECS1 --> DYNB
    ECS1 --> SQS
    ECS1 --> ECR
    ECS1 --> EFS1
    
    ECS2 --> S3B
    ECS2 --> DYNB
    ECS2 --> SQS
    ECS2 --> ECR
    ECS2 --> EFS2
    
    style S3B fill:#90EE90
    style SQS fill:#FFB6C1
```

## Queue Architecture

```mermaid
graph LR
    subgraph "Input Queues"
        EQ[Email Queue]
        UQ[Unclaimed Queue]
        PQ1[amelia-scott Input]
        PQ2[amelia-alice Input]
        PQ3[test-scott Input]
    end
    
    subgraph "Output Queues"
        OQ1[amelia-scott Output]
        OQ2[amelia-alice Output]
        OQ3[test-scott Output]
    end
    
    subgraph "Error Handling"
        DLQ1[Email DLQ]
        DLQ2[Processing DLQ]
    end
    
    EQ -->|Parse Error| DLQ1
    PQ1 -->|Process Error| DLQ2
    PQ2 -->|Process Error| DLQ2
    PQ3 -->|Process Error| DLQ2
    
    style DLQ1 fill:#FF6B6B
    style DLQ2 fill:#FF6B6B
```

## S3 Deployment Pattern

```mermaid
graph TD
    subgraph "Container Workspace"
        CW[/mnt/efs/amelia-scott/]
        REPO[Git Repository]
        SRC[Source Files]
        DIST[dist/]
    end
    
    subgraph "Build Process"
        NPM[npm run build]
        ASTRO[Astro Builder]
    end
    
    subgraph "S3 Deployment"
        SYNC[aws s3 sync]
        BUCKET[edit.amelia.webordinary.com]
        CF[CloudFront]
        DNS[Route53]
    end
    
    CW --> REPO
    REPO --> SRC
    SRC --> NPM
    NPM --> ASTRO
    ASTRO --> DIST
    DIST --> SYNC
    SYNC --> BUCKET
    BUCKET --> CF
    CF --> DNS
    DNS -->|https://edit.amelia.webordinary.com| USER[User Browser]
    
    style BUCKET fill:#90EE90
    style CF fill:#87CEEB
```

## Cost Optimization Strategy

```mermaid
pie title Monthly AWS Costs
    "Fargate Containers" : 50
    "S3 Storage" : 10
    "CloudFront CDN" : 5
    "DynamoDB" : 5
    "SQS Messages" : 2
    "EFS Storage" : 10
    "Data Transfer" : 8
    "CloudWatch" : 10
```

## Security Model

```mermaid
graph TB
    subgraph "Public Layer"
        PUB[Internet]
        CF[CloudFront]
        S3[S3 Public Read]
    end
    
    subgraph "Private Layer"
        VPC[VPC Private Subnets]
        ECS[ECS Tasks]
        EFS[EFS Mounts]
    end
    
    subgraph "Access Control"
        IAM[IAM Roles]
        SG[Security Groups]
        NACL[Network ACLs]
    end
    
    subgraph "Data Security"
        ENC1[S3 Encryption]
        ENC2[DynamoDB Encryption]
        ENC3[EFS Encryption]
        TLS[TLS in Transit]
    end
    
    PUB --> CF
    CF --> S3
    
    VPC --> ECS
    ECS --> EFS
    
    IAM --> ECS
    SG --> VPC
    NACL --> VPC
    
    S3 --> ENC1
    ECS --> ENC2
    EFS --> ENC3
    CF --> TLS
    
    style VPC fill:#90EE90
    style IAM fill:#FFB6C1
```

---

These diagrams represent the current S3-based architecture. For implementation details, see the component READMEs.