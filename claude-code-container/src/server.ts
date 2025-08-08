import express from 'express';
import { ClaudeExecutor } from './claude-executor';
import { AstroManager } from './astro-manager';
import { ThreadManager } from './thread-manager';

const app = express();
const threadManager = new ThreadManager();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS middleware for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    workspace: process.env.WORKSPACE_PATH || '/workspace',
    client: process.env.CLIENT_ID || 'not_set',
    user: process.env.USER_ID || 'not_set',
    thread: process.env.THREAD_ID || 'not_set',
    version: '1.0.0'
  });
});

// Initialize workspace for client/user/thread
app.post('/api/init', async (req, res) => {
  const { clientId, userId, threadId, repoUrl } = req.body;
  
  // Validate required parameters
  if (!clientId || !userId || !threadId) {
    return res.status(400).json({ 
      success: false, 
      error: 'clientId, userId, and threadId are required' 
    });
  }
  
  try {
    console.log(`Initializing workspace for ${clientId}/${userId}/${threadId}`);
    
    const workspace = await threadManager.initializeWorkspace(
      clientId,
      userId,
      threadId,
      repoUrl
    );
    
    // Start Astro dev server in the workspace (if not already running)
    const astro = new AstroManager(workspace.projectPath);
    
    if (!astro.isRunning()) {
      console.log('Starting Astro dev server...');
      await astro.start();
    } else {
      console.log('Astro dev server already running');
    }
    
    res.json({ 
      success: true, 
      workspace: {
        projectPath: workspace.projectPath,
        branch: workspace.branch,
        resumed: workspace.resumed
      },
      astro: {
        url: astro.getUrl(),
        websocket: astro.getWebSocketUrl(),
        running: astro.isRunning()
      }
    });
    
  } catch (error) {
    console.error('Initialization error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// Execute Claude Code instruction with thread persistence
app.post('/api/execute', async (req, res) => {
  const { instruction, clientId, userId, threadId, mode = 'execute' } = req.body;
  
  // Validate required parameters
  if (!instruction || !clientId || !userId || !threadId) {
    return res.status(400).json({ 
      success: false, 
      error: 'instruction, clientId, userId, and threadId are required' 
    });
  }
  
  try {
    console.log(`Executing instruction for ${clientId}/${userId}/${threadId}: ${instruction}`);
    
    // Ensure we're on the right branch
    const workspace = await threadManager.switchToThread(clientId, userId, threadId);
    const claude = new ClaudeExecutor(workspace);
    
    // Load thread context
    const context = await threadManager.loadThreadContext(clientId, userId, threadId);
    
    const result = await claude.execute({
      instruction,
      mode,
      context: {
        ...context,
        workingDirectory: workspace.projectPath,
        gitBranch: workspace.branch,
        threadId
      }
    });
    
    // Save thread context
    await threadManager.saveThreadContext(clientId, userId, threadId, result.context);
    
    // Auto-commit changes to thread branch if files were changed
    if (result.filesChanged.length > 0) {
      const commitMessage = `Thread ${threadId}: ${instruction.substring(0, 50)}${instruction.length > 50 ? '...' : ''}`;
      await threadManager.commitChanges(workspace.projectPath, commitMessage);
    }
    
    res.json({ 
      success: result.success, 
      result: {
        output: result.output,
        filesChanged: result.filesChanged,
        error: result.error
      }
    });
    
  } catch (error) {
    console.error('Execution error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// Get workspace status
app.get('/api/status/:clientId/:userId/:threadId', async (req, res) => {
  const { clientId, userId, threadId } = req.params;
  
  try {
    const workspace = await threadManager.switchToThread(clientId, userId, threadId);
    const claude = new ClaudeExecutor(workspace);
    const status = await claude.getStatus();
    
    const gitBranches = await threadManager.listBranches(workspace.projectPath);
    
    res.json({
      success: true,
      status: {
        ...status,
        currentBranch: workspace.branch,
        allBranches: gitBranches,
        projectPath: workspace.projectPath
      }
    });
    
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// Get git status for workspace
app.get('/api/git/:clientId/:userId/:threadId', async (req, res) => {
  const { clientId, userId, threadId } = req.params;
  
  try {
    const workspace = await threadManager.switchToThread(clientId, userId, threadId);
    const gitStatus = await threadManager.getGitStatus(workspace.projectPath);
    const branches = await threadManager.listBranches(workspace.projectPath);
    
    res.json({
      success: true,
      git: {
        status: gitStatus,
        currentBranch: workspace.branch,
        branches
      }
    });
    
  } catch (error) {
    console.error('Git status error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// Restart Astro dev server
app.post('/api/astro/restart/:clientId/:userId/:threadId', async (req, res) => {
  const { clientId, userId, threadId } = req.params;
  
  try {
    const workspace = await threadManager.switchToThread(clientId, userId, threadId);
    const astro = new AstroManager(workspace.projectPath);
    
    // Stop existing server
    if (astro.isRunning()) {
      await astro.stop();
    }
    
    // Start new server
    await astro.start();
    
    res.json({
      success: true,
      astro: {
        url: astro.getUrl(),
        websocket: astro.getWebSocketUrl(),
        running: astro.isRunning()
      }
    });
    
  } catch (error) {
    console.error('Astro restart error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// Build Astro project
app.post('/api/astro/build/:clientId/:userId/:threadId', async (req, res) => {
  const { clientId, userId, threadId } = req.params;
  
  try {
    const workspace = await threadManager.switchToThread(clientId, userId, threadId);
    const astro = new AstroManager(workspace.projectPath);
    
    await astro.build();
    
    res.json({
      success: true,
      message: 'Build completed successfully'
    });
    
  } catch (error) {
    console.error('Build error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// ===== ENHANCED GIT OPERATIONS =====

// Get enhanced git status with remote comparison
app.get('/api/git/status/:clientId/:userId/:threadId', async (req, res) => {
  const { clientId, userId, threadId } = req.params;
  
  try {
    const workspace = await threadManager.switchToThread(clientId, userId, threadId);
    const status = await threadManager.getEnhancedStatus(workspace.projectPath);
    
    res.json({
      success: true,
      status
    });
    
  } catch (error) {
    console.error('Enhanced git status error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// Smart commit with auto-push
app.post('/api/git/commit/:clientId/:userId/:threadId', async (req, res) => {
  const { clientId, userId, threadId } = req.params;
  const { message } = req.body;
  
  if (!message) {
    return res.status(400).json({ 
      success: false, 
      error: 'Commit message is required' 
    });
  }
  
  try {
    const workspace = await threadManager.switchToThread(clientId, userId, threadId);
    const result = await threadManager.smartCommit(workspace.projectPath, message, threadId);
    
    res.json({
      success: true,
      result
    });
    
  } catch (error) {
    console.error('Smart commit error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// Push to remote
app.post('/api/git/push/:clientId/:userId/:threadId', async (req, res) => {
  const { clientId, userId, threadId } = req.params;
  const { force = false } = req.body;
  
  try {
    const workspace = await threadManager.switchToThread(clientId, userId, threadId);
    const result = await threadManager.pushToRemote(workspace.projectPath, workspace.branch, force);
    
    res.json({
      success: true,
      result
    });
    
  } catch (error) {
    console.error('Push error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// Pull from remote
app.post('/api/git/pull/:clientId/:userId/:threadId', async (req, res) => {
  const { clientId, userId, threadId } = req.params;
  const { branch } = req.body;
  
  try {
    const workspace = await threadManager.switchToThread(clientId, userId, threadId);
    const targetBranch = branch || 'main';
    
    await threadManager.pullFromRemote(workspace.projectPath, targetBranch);
    
    res.json({
      success: true,
      message: `Successfully pulled from ${targetBranch}`
    });
    
  } catch (error) {
    console.error('Pull error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// Fetch from remote
app.post('/api/git/fetch/:clientId/:userId/:threadId', async (req, res) => {
  const { clientId, userId, threadId } = req.params;
  
  try {
    const workspace = await threadManager.switchToThread(clientId, userId, threadId);
    await threadManager.fetchRemote(workspace.projectPath);
    
    res.json({
      success: true,
      message: 'Successfully fetched from remote'
    });
    
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// Switch branch
app.post('/api/git/branch/:clientId/:userId/:threadId', async (req, res) => {
  const { clientId, userId, threadId } = req.params;
  const { branch, createNew = false } = req.body;
  
  if (!branch) {
    return res.status(400).json({ 
      success: false, 
      error: 'Branch name is required' 
    });
  }
  
  try {
    const workspace = await threadManager.switchToThread(clientId, userId, threadId);
    await threadManager.switchBranch(workspace.projectPath, branch, createNew);
    
    res.json({
      success: true,
      message: `Successfully switched to branch: ${branch}`,
      branch
    });
    
  } catch (error) {
    console.error('Branch switch error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.path}`
  });
});

const port = process.env.PORT || 8080;

app.listen(port, () => {
  console.log(`Claude Code container server listening on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log('Available endpoints:');
  console.log('  POST /api/init - Initialize workspace');
  console.log('  POST /api/execute - Execute Claude instruction');
  console.log('  GET  /api/status/:clientId/:userId/:threadId - Get workspace status');
  console.log('  GET  /api/git/:clientId/:userId/:threadId - Get git status');
  console.log('  POST /api/astro/restart/:clientId/:userId/:threadId - Restart Astro server');
  console.log('  POST /api/astro/build/:clientId/:userId/:threadId - Build Astro project');
  console.log('');
  console.log('Enhanced Git Operations:');
  console.log('  GET  /api/git/status/:clientId/:userId/:threadId - Enhanced git status');
  console.log('  POST /api/git/commit/:clientId/:userId/:threadId - Smart commit with auto-push');
  console.log('  POST /api/git/push/:clientId/:userId/:threadId - Push to remote');
  console.log('  POST /api/git/pull/:clientId/:userId/:threadId - Pull from remote');
  console.log('  POST /api/git/fetch/:clientId/:userId/:threadId - Fetch from remote');
  console.log('  POST /api/git/branch/:clientId/:userId/:threadId - Switch/create branch');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});