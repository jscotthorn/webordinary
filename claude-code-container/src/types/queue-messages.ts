/**
 * Message types for Step Functions integration
 */

/**
 * Message format received from Step Functions via SQS
 */
export interface StepFunctionMessage {
  /**
   * Task token for Step Functions callback
   */
  taskToken: string;
  
  /**
   * Unique message identifier
   */
  messageId: string;
  
  /**
   * Instruction to execute
   */
  instruction: string;
  
  /**
   * Thread identifier for git branch management
   */
  threadId: string;
  
  /**
   * Project identifier (e.g., 'amelia')
   */
  projectId: string;
  
  /**
   * User identifier (e.g., 'scott')
   */
  userId: string;
  
  /**
   * Attachments if any
   */
  attachments?: any[];
  
  /**
   * Additional context for the instruction
   */
  context?: {
    requiresPlanning?: boolean;
    [key: string]: any;
  };
}

/**
 * Response sent back to Step Functions
 */
export interface StepFunctionResponse {
  /**
   * Whether the operation was successful
   */
  success: boolean;
  
  /**
   * Unique message identifier
   */
  messageId: string;
  
  /**
   * Summary of what was done
   */
  summary?: string;
  
  /**
   * List of files that were changed
   */
  filesChanged?: string[];
  
  /**
   * Deployed site URL
   */
  siteUrl?: string;
  
  /**
   * Build success status
   */
  buildSuccess?: boolean;
  
  /**
   * Deploy success status
   */
  deploySuccess?: boolean;
}

/**
 * Interrupt message format
 */
export interface InterruptMessage {
  /**
   * Reason for interruption
   */
  reason: string;
  
  /**
   * New thread that is taking over
   */
  newThreadId: string;
  
  /**
   * New message ID
   */
  newMessageId: string;
  
  /**
   * Timestamp of interruption
   */
  timestamp: number;
}

/**
 * Active job record in DynamoDB
 */
export interface ActiveJob {
  /**
   * Composite key: projectId#userId
   */
  projectUserKey: string;
  
  /**
   * Message identifier
   */
  messageId: string;
  
  /**
   * Step Functions task token
   */
  taskToken: string;
  
  /**
   * SQS receipt handle
   */
  receiptHandle: string;
  
  /**
   * Thread identifier
   */
  threadId: string;
  
  /**
   * Container processing this job
   */
  containerId: string;
  
  /**
   * Timestamp when job started
   */
  startTime: number;
  
  /**
   * TTL for DynamoDB expiration
   */
  ttl: number;
}