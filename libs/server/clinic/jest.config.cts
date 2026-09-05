module.exports = {
  displayName: 'server-clinic',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Domain suites here talk to a real PostgreSQL: the guarantees under test
  // are unique indexes and row locks, and a mock would only prove the mock.
  testTimeout: 30_000,
  coverageDirectory: '../../../coverage/libs/server/clinic',
};
