module.exports = {
  displayName: 'server-payments',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // These libraries are deliberate empty domain boundaries: no behaviour has
  // been implemented yet, so there is nothing meaningful to assert.
  passWithNoTests: true,
  coverageDirectory: '../../../coverage/libs/server/payments',
};
