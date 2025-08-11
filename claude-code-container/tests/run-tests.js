#!/usr/bin/env node

/**
 * Main Test Runner for Claude Code Container
 * Orchestrates running different test suites
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Load environment variables from .env.local if it exists
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=').trim();
      if (key && value) {
        // Only set if not already in environment (allows override)
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  });
  console.log('📋 Loaded environment from .env.local');
}

// Colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// Test suites configuration
const testSuites = {
  unit: {
    name: 'Unit Tests',
    description: 'Unit tests for individual components',
    files: [],
    runner: 'jest'
  },
  integration: {
    name: 'Integration Tests',
    description: 'Integration tests for service interactions',
    files: [
      'container.test.js',
      // 'multi-session.test.js', // Requires AWS credentials and scenario arg
      'git-push.test.sh',
      'git-scenarios.test.sh'
    ],
    runner: 'mixed'
  },
  e2e: {
    name: 'End-to-End Tests',
    description: 'Full workflow tests with real services',
    files: [
      'local-container.test.sh'
    ],
    runner: 'shell'
  },
  scripts: {
    name: 'Script Tests',
    description: 'Tests for utility scripts',
    files: [
      'git-ops.test.sh',
      'local-shell.test.sh',
      's3-sync.test.sh',
      'run-s3.test.sh'
    ],
    runner: 'shell'
  }
};

// Run a single test file
async function runTest(filePath, type) {
  return new Promise((resolve) => {
    console.log(`${colors.cyan}Running: ${path.basename(filePath)}${colors.reset}`);
    
    let command, args;
    
    if (filePath.endsWith('.js')) {
      command = 'node';
      args = [filePath];
    } else if (filePath.endsWith('.sh')) {
      command = 'bash';
      args = [filePath];
    } else {
      console.log(`${colors.red}Unknown file type: ${filePath}${colors.reset}`);
      resolve(false);
      return;
    }
    
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: path.dirname(filePath),
      env: process.env  // Pass all environment variables including those from .env.local
    });
    
    child.on('exit', (code) => {
      if (code === 0) {
        console.log(`${colors.green}✅ ${path.basename(filePath)} passed${colors.reset}\n`);
        resolve(true);
      } else {
        console.log(`${colors.red}❌ ${path.basename(filePath)} failed (exit code: ${code})${colors.reset}\n`);
        resolve(false);
      }
    });
    
    child.on('error', (err) => {
      console.error(`${colors.red}Error running ${filePath}: ${err.message}${colors.reset}`);
      resolve(false);
    });
  });
}

// Run a test suite
async function runSuite(suiteName) {
  const suite = testSuites[suiteName];
  if (!suite) {
    console.error(`${colors.red}Unknown test suite: ${suiteName}${colors.reset}`);
    return false;
  }
  
  console.log(`\n${colors.bright}${colors.blue}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.bright}${suite.name}${colors.reset}`);
  console.log(`${colors.yellow}${suite.description}${colors.reset}`);
  console.log(`${colors.blue}${'='.repeat(60)}${colors.reset}\n`);
  
  if (suite.files.length === 0) {
    console.log(`${colors.yellow}No tests found in this suite${colors.reset}`);
    return true;
  }
  
  let passed = 0;
  let failed = 0;
  
  for (const file of suite.files) {
    const filePath = path.join(__dirname, suiteName, file);
    
    if (!fs.existsSync(filePath)) {
      console.log(`${colors.yellow}⚠️  Skipping ${file} (file not found)${colors.reset}`);
      continue;
    }
    
    const result = await runTest(filePath, suite.runner);
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }
  
  // Suite summary
  console.log(`${colors.bright}Suite Results:${colors.reset}`);
  console.log(`${colors.green}  Passed: ${passed}${colors.reset}`);
  if (failed > 0) {
    console.log(`${colors.red}  Failed: ${failed}${colors.reset}`);
  }
  
  return failed === 0;
}

// Run specific test by name
async function runSpecificTest(testName) {
  // Search for test file across all suites
  for (const [suiteName, suite] of Object.entries(testSuites)) {
    for (const file of suite.files) {
      if (file.includes(testName) || file === testName) {
        const filePath = path.join(__dirname, suiteName, file);
        if (fs.existsSync(filePath)) {
          console.log(`\n${colors.bright}Running specific test: ${file}${colors.reset}\n`);
          const result = await runTest(filePath, suite.runner);
          return result;
        }
      }
    }
  }
  
  console.error(`${colors.red}Test not found: ${testName}${colors.reset}`);
  console.log('\nAvailable tests:');
  for (const [suiteName, suite] of Object.entries(testSuites)) {
    if (suite.files.length > 0) {
      console.log(`\n${colors.yellow}${suite.name}:${colors.reset}`);
      suite.files.forEach(file => {
        console.log(`  - ${file}`);
      });
    }
  }
  return false;
}

// Main test runner
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  console.log(`${colors.bright}${colors.cyan}🧪 Claude Code Container Test Runner${colors.reset}\n`);
  
  let allPassed = true;
  
  switch (command) {
    case 'all':
      // Run all test suites
      for (const suiteName of Object.keys(testSuites)) {
        const passed = await runSuite(suiteName);
        allPassed = allPassed && passed;
      }
      break;
      
    case 'unit':
    case 'integration':
    case 'e2e':
    case 'scripts':
      // Run specific suite
      allPassed = await runSuite(command);
      break;
      
    case 'list':
      // List all available tests
      console.log('Available test suites:\n');
      for (const [name, suite] of Object.entries(testSuites)) {
        console.log(`${colors.yellow}${name}${colors.reset} - ${suite.description}`);
        if (suite.files.length > 0) {
          suite.files.forEach(file => {
            console.log(`  - ${file}`);
          });
        } else {
          console.log(`  ${colors.cyan}(no tests)${colors.reset}`);
        }
        console.log();
      }
      break;
      
    case 'help':
    case undefined:
      // Show help
      console.log('Usage: npm test [command] [options]\n');
      console.log('Commands:');
      console.log('  all              Run all test suites');
      console.log('  unit             Run unit tests');
      console.log('  integration      Run integration tests');
      console.log('  e2e              Run end-to-end tests');
      console.log('  scripts          Run script tests');
      console.log('  list             List all available tests');
      console.log('  <test-name>      Run specific test by name');
      console.log('\nExamples:');
      console.log('  npm test                    Show this help');
      console.log('  npm test all                Run all tests');
      console.log('  npm test integration        Run integration tests');
      console.log('  npm test multi-session      Run specific test');
      break;
      
    default:
      // Try to run specific test
      allPassed = await runSpecificTest(command);
      break;
  }
  
  // Final summary
  console.log(`\n${colors.bright}${'='.repeat(60)}${colors.reset}`);
  if (allPassed) {
    console.log(`${colors.green}${colors.bright}✅ All tests passed!${colors.reset}`);
    process.exit(0);
  } else {
    console.log(`${colors.red}${colors.bright}❌ Some tests failed${colors.reset}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    console.error(`${colors.red}Test runner error: ${err.message}${colors.reset}`);
    process.exit(1);
  });
}

module.exports = { runTest, runSuite, runSpecificTest };