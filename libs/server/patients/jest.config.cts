module.exports = {
  displayName: 'server-patients',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Serial, and it has to be.
  //
  // These suites link guardians to a *borrowed* auth user - the project has
  // two real accounts and creating more is not this domain's business. The
  // guardian resolver is deliberately not clinic-scoped, because at sign-in
  // the API holds a token and learns the tenant from the row it finds. Two
  // spec files running at once therefore link two guardians in two fixture
  // clinics to the same account, and the resolver answers with whichever won.
  //
  // That is a property of the fixture, not of the code: one person is one
  // guardian per clinic in production. Running the files in order removes the
  // race without weakening what they assert.
  maxWorkers: 1,
  testTimeout: 30_000,
  coverageDirectory: '../../../coverage/libs/server/patients',
};
