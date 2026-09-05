module.exports = {
  displayName: 'server-workflows',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // An empty boundary for now: the three Phase 2 workflows land once booking
  // and queue exist to orchestrate. Placeholder tests that assert nothing are
  // worse than no tests.
  passWithNoTests: true,
  coverageDirectory: '../../../coverage/libs/server/workflows',
};
