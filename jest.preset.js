const nxPreset = require('@nx/jest/preset').default;

module.exports = {
  ...nxPreset,
  // Loads the workspace .env, so a domain suite can reach a real database.
  // Resolved from this file rather than <rootDir>, because projects sit at
  // different depths and a relative path would be wrong for half of them.
  setupFiles: [require('node:path').join(__dirname, 'jest.setup-env.ts')],
  // `@nestjs/config` v12 is ESM-only: "type": "module", and its exports map
  // offers no CommonJS entry. Jest runs CommonJS here, so it cannot require it
  // and must transform it instead.
  //
  // This bites any server test that imports the `@clinic/server-core` barrel,
  // because the barrel re-exports ServerConfigModule. That is every controller
  // and domain-service test, so the exception belongs in the shared preset
  // rather than being rediscovered in each project.
  //
  // The pattern allows for pnpm's layout, where the path contains
  // `/node_modules/.pnpm/@nestjs+config@<version>/node_modules/@nestjs/config/`.
  transformIgnorePatterns: ['/node_modules/(?!.*@nestjs[+/]config)'],
};
