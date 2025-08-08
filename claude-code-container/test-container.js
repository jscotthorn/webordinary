const axios = require('axios');

async function testContainer() {
  const baseUrl = 'http://localhost:8080';
  const client = 'test-client';
  const user = 'test-user';
  const thread = `test-${Date.now()}`;
  
  try {
    console.log('🧪 Testing Enhanced Git Operations Container');
    
    // Test 1: Health Check
    console.log('\n1. Health check...');
    const health = await axios.get(`${baseUrl}/health`);
    console.log('✅ Health:', health.data.status);
    
    // Test 2: Initialize workspace (without repo for now)
    console.log('\n2. Initialize workspace...');
    const init = await axios.post(`${baseUrl}/api/init`, {
      clientId: client,
      userId: user,
      threadId: thread
    });
    console.log('✅ Init successful:', init.data.success);
    console.log('   Branch:', init.data.workspace.branch);
    
    // Test 3: Get enhanced git status
    console.log('\n3. Get enhanced git status...');
    try {
      const status = await axios.get(`${baseUrl}/api/git/status/${client}/${user}/${thread}`);
      console.log('✅ Git status:', status.data.status);
    } catch (error) {
      console.log('⚠️  Git status (expected without repo):', error.response?.data?.error || error.message);
    }
    
    // Test 4: Execute instruction that creates a file
    console.log('\n4. Execute file creation...');
    const execute = await axios.post(`${baseUrl}/api/execute`, {
      clientId: client,
      userId: user,
      threadId: thread,
      instruction: 'Create a test file called hello.md with some content',
      mode: 'execute'
    });
    console.log('✅ Execution result:', execute.data.success);
    console.log('   Output preview:', execute.data.output.substring(0, 100) + '...');
    
    console.log('\n🎉 All tests completed successfully!');
    console.log(`📁 Test workspace: /workspace/${client}/${user}/project`);
    console.log(`🌿 Test branch: thread-${thread}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Only run if axios is available
try {
  testContainer();
} catch (error) {
  console.log('📦 Please install axios first: npm install axios');
  console.log('Or test manually using curl commands from the test script');
}