module.exports = {
  displayName: 'server-booking',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  maxWorkers: 1,
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Domain suites here talk to a real PostgreSQL: the guarantee under test is
  // a partial unique index deciding a race, and a mock would only prove the
  // mock.
  testTimeout: 30_000,
  coverageDirectory: '../../../coverage/libs/server/booking',
};
