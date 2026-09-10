module.exports = {
  displayName: 'api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  maxWorkers: 1,
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Every suite here talks to a real PostgreSQL over the network, and a single
  // test is a handful of HTTP calls each making several round trips. Jest's
  // 5-second default measures the link, not the code.
  testTimeout: 30_000,
  coverageDirectory: '../../coverage/apps/api',
};
