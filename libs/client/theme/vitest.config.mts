import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/client/theme',
  // Resolves the @clinic/* mappings from tsconfig.base.json (Vite 8 native).
  resolve: { tsconfigPaths: true },
  test: {
    name: 'client-theme',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    // A token layer has no behaviour: it is CSS custom properties and a font
    // import. What could be asserted here (that a hex value equals itself)
    // would be a test of the test. The design it encodes is verified by
    // looking at the apps that consume it.
    passWithNoTests: true,
    coverage: {
      reportsDirectory: '../../../coverage/libs/client/theme',
      provider: 'v8' as const,
    },
  },
}));
