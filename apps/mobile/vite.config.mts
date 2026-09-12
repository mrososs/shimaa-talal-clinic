/// <reference types='vitest' />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { mobilePwaOptions } from './src/app/pwa/pwa.config.mts';

export default defineConfig(() => ({
  root: import.meta.dirname,
  // root is this app directory, so Vite would look for .env here. The
  // workspace keeps a single .env at the repo root - point at it explicitly,
  // or every VITE_* variable silently resolves to undefined in the bundle.
  envDir: '../../',
  cacheDir: '../../node_modules/.vite/apps/mobile',
  server: {
    port: 4202,
    host: 'localhost',
  },
  preview: {
    port: 4302,
    host: 'localhost',
  },
  plugins: [vue(), VitePWA(mobilePwaOptions)],
  // Resolves the `@clinic/*` mappings from tsconfig.base.json.
  // Vite 8 does this natively, so no vite-tsconfig-paths plugin is needed.
  resolve: { tsconfigPaths: true },
  build: {
    // Keep the Nx workspace output stable; Vercel serves this directory.
    outDir: '../../dist/apps/mobile',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    name: 'mobile',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/mobile',
      provider: 'v8' as const,
    },
  },
}));
