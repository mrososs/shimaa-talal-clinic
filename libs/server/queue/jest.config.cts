module.exports = {
  displayName: 'server-queue',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Domain suites here talk to a real PostgreSQL: the guarantees under test
  // are partial unique indexes and a row lock deciding a race, and a mock
  // would only prove the mock.
  testTimeout: 30_000,
  coverageDirectory: '../../../coverage/libs/server/queue',
};
