import type { VitePWAOptions } from 'vite-plugin-pwa';

export const PWA_ICON_PATHS = {
  icon192: '/pwa-192x192.png',
  icon512: '/pwa-512x512.png',
  maskable512: '/pwa-maskable-512x512.png',
  appleTouch: '/apple-touch-icon.png',
} as const;

/**
 * Build-time PWA policy for the parent client.
 *
 * Only the versioned application shell is precached. There is deliberately no
 * runtime caching: guardian, child, appointment, queue and authentication
 * responses must always come from their owning servers.
 */
export const mobilePwaOptions = {
  strategies: 'generateSW',
  registerType: 'prompt',
  injectRegister: false,
  includeManifestIcons: true,
  devOptions: { enabled: false },
  manifest: {
    id: '/',
    name: 'عيادة د. شيماء طلال',
    short_name: 'عيادة شيماء',
    description: 'تطبيق الأهل لحجز المواعيد ومتابعة الطابور في عيادة د. شيماء طلال.',
    lang: 'ar',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#FFF4EC',
    theme_color: '#FF7E5F',
    icons: [
      {
        src: PWA_ICON_PATHS.icon192,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: PWA_ICON_PATHS.icon512,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: PWA_ICON_PATHS.maskable512,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{html,js,css,woff,woff2,png,svg,ico}'],
    navigateFallback: 'index.html',
    navigateFallbackDenylist: [
      /^\/api(?:\/|$)/,
      /^\/auth\/v1(?:\/|$)/,
      /^\/rest\/v1(?:\/|$)/,
      /^\/storage\/v1(?:\/|$)/,
    ],
    runtimeCaching: [],
    cleanupOutdatedCaches: true,
    clientsClaim: false,
    skipWaiting: false,
  },
} satisfies Partial<VitePWAOptions>;
