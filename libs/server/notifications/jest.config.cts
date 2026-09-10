module.exports = {
  displayName: 'server-notifications',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  maxWorkers: 1,
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // The inbox suite talks to a real PostgreSQL: unread is a join against a
  // per-member read marker, "sent twice, stored once" is a unique index, and
  // "already decided" is a `where` clause. A mock would only prove the mock.
  testTimeout: 30_000,
  coverageDirectory: '../../../coverage/libs/server/notifications',
};
