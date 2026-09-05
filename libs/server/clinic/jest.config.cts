module.exports = {
  displayName: 'server-clinic',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // An empty boundary for now: the clinic schema and its services land with
  // the identity and scheduling migrations. Placeholder tests that assert
  // nothing are worse than no tests.
  passWithNoTests: true,
  coverageDirectory: '../../../coverage/libs/server/clinic',
};
