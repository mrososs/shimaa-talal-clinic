import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/client/ui',
  plugins: [vue()],
  // Resolves the @clinic/* mappings from tsconfig.base.json (Vite 8 native).
  resolve: { tsconfigPaths: true },
  test: {
    name: 'client-ui',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/client/ui',
      provider: 'v8' as const,
    },
  },
}));
