import { describe, expect, it } from 'vitest';
import { mobilePwaOptions, PWA_ICON_PATHS } from './pwa.config.mts';

describe('mobile PWA policy', () => {
  it('publishes the Arabic standalone manifest contract', () => {
    expect(mobilePwaOptions.manifest).toMatchObject({
      id: '/',
      name: 'عيادة د. شيماء طلال',
      short_name: 'عيادة شيماء',
      lang: 'ar',
      dir: 'rtl',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait-primary',
      background_color: '#FFF4EC',
      theme_color: '#FF7E5F',
    });
    expect(mobilePwaOptions.manifest.icons.map((icon) => icon.src)).toEqual([
      PWA_ICON_PATHS.icon192,
      PWA_ICON_PATHS.icon512,
      PWA_ICON_PATHS.maskable512,
    ]);
  });

  it('never runtime-caches protected business or auth responses', () => {
    expect(mobilePwaOptions.workbox.runtimeCaching).toEqual([]);
    const denylist = mobilePwaOptions.workbox.navigateFallbackDenylist;

    for (const path of [
      '/api/clinic/appointments',
      '/auth/v1/token',
      '/rest/v1/guardians',
      '/storage/v1/object/avatar',
    ]) {
      expect(denylist.some((pattern) => pattern.test(path))).toBe(true);
    }
    expect(denylist.some((pattern) => pattern.test('/tabs/home'))).toBe(false);
  });

  it('requires an explicit user action before activating an update', () => {
    expect(mobilePwaOptions.registerType).toBe('prompt');
    expect(mobilePwaOptions.workbox.skipWaiting).toBe(false);
    expect(mobilePwaOptions.workbox.clientsClaim).toBe(false);
    expect(mobilePwaOptions.devOptions.enabled).toBe(false);
  });
});
