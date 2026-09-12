# Parent Vue PWA deployment

`apps/mobile` is the browser-first parent client. It remains Vue 3 + Ionic Vue
and builds to `dist/apps/mobile`; Ionic supplies the mobile UI and navigation,
while the browser supplies installation, lifecycle, and session storage.

## Vercel project

Create a dedicated Vercel project from the repository root. The tracked
`vercel.json` builds only `mobile`, serves `dist/apps/mobile`, falls back to
`index.html` for Vue Router deep links, and applies these cache rules:

- `index.html`, `sw.js`, and `manifest.webmanifest`: revalidate on every visit;
- fingerprinted `/assets/*`: one year, immutable;
- application shell files: precached by Workbox;
- API, Supabase Auth, REST, Storage, appointments, patients, payments, and queue
  responses: never runtime-cached.

Configure these public variables on the Parent PWA project:

```text
VITE_API_URL=https://api.example.com/api/v1
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_MOBILE_APP_URL=https://parents.example.com
VITE_APP_ENV=production
```

Never place the Supabase secret key or a PostgreSQL URL in a `VITE_` variable.

On the API deployment set `API_CORS_ORIGINS` to an explicit comma-separated
allow-list. Production startup rejects an empty value and `*`. Include the
stable Parent PWA origin and the production Dashboard origin because both are
browser API clients. Add a staging origin only when it is stable; do not allow
wildcard Vercel preview domains.

## Install and update behavior

- Chrome/Edge receive a small install action on Home when
  `beforeinstallprompt` is available.
- iOS Safari receives Share → Add to Home Screen guidance.
- Standalone, installed, and locally dismissed clients do not see the prompt.
- A waiting service worker shows an update banner. It activates only after the
  user chooses update, so a booking form cannot reload unexpectedly.
- Offline mode shows a warning. There is no offline mutation queue and no
  business operation reports success without a server response.

## Required brand asset gate

Before publishing or removing Capacitor, place the official square clinic logo
in the repository and generate these files under `apps/mobile/public`:

```text
pwa-192x192.png
pwa-512x512.png
pwa-maskable-512x512.png
apple-touch-icon.png
```

The source must be a square SVG or a PNG of at least 1024×1024. Do not ship a
placeholder: missing icons make the manifest incomplete and block the agreed
installability checkpoint. Capacitor dependencies, configuration, targets, and
the locally generated Android project remain available until this gate and the
Android/iPhone checks below pass.

## Release verification

1. Run Mobile lint, typecheck, tests, and production build.
2. Preview the production output; development intentionally has no service
   worker.
3. In Chrome Application inspect manifest, icon purposes, scope, start URL,
   active worker, and Cache Storage.
4. Refresh a nested route directly and confirm it returns the app shell.
5. Confirm Cache Storage contains no API/Auth/REST/Storage responses.
6. Verify login restoration, booking, appointment management, payments, live
   queue, notifications, and messages at small phone, Pixel, iPhone, and narrow
   desktop sizes.
7. Verify Android Chrome installation on the HTTPS Vercel deployment.
8. Verify Add to Home Screen and safe areas on a physical iPhone Safari; Chrome
   emulation is not proof of iOS installation.

Only after all eight checks pass should the final Capacitor removal commit be
made.
