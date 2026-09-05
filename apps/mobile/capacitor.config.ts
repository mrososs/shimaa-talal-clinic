import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Base Capacitor setup for the clinic mobile app.
 *
 * `webDir` points at the Nx build output, so the native shell always ships the
 * artefact produced by `nx build mobile` — never a stale local build.
 *
 * No native plugins are configured on purpose: no camera, push, geolocation,
 * filesystem or biometrics. Each is added when a feature actually needs it.
 */
const config: CapacitorConfig = {
  appId: 'sa.com.clinicplatform.app',
  appName: 'Clinic',
  webDir: '../../dist/apps/mobile',
  server: {
    androidScheme: 'https',
  },
};

export default config;
