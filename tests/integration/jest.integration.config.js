module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 300000, // 5 minutes for integration tests
  setupFilesAfterEnv: ['<rootDir>/src/setup-tests.ts'],
  testMatch: [
    '<rootDir>/scenarios/**/*.test.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/setup-tests.ts'
  ],
  coverageDirectory: 'results/coverage',
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'results',
        outputName: 'test-results.xml'
      }
    ]
  ],
  verbose: true,
  maxWorkers: 1, // Run tests sequentially to avoid resource conflicts
  forceExit: true,
  detectOpenHandles: true
};