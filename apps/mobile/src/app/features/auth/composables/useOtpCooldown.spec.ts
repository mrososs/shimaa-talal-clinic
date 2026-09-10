import { effectScope } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOtpCooldown } from './useOtpCooldown';

describe('useOtpCooldown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts down and allows resend at zero', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T10:00:00Z'));
    const scope = effectScope();
    const cooldown = scope.run(() => useOtpCooldown(Date.now(), 3));

    expect(cooldown?.remainingSeconds.value).toBe(3);
    expect(cooldown?.canResend.value).toBe(false);

    vi.advanceTimersByTime(3_000);
    expect(cooldown?.remainingSeconds.value).toBe(0);
    expect(cooldown?.canResend.value).toBe(true);
    scope.stop();
  });

  it('restarts after another code is sent', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T10:00:00Z'));
    const scope = effectScope();
    const cooldown = scope.run(() => useOtpCooldown(Date.now() - 60_000));

    expect(cooldown?.canResend.value).toBe(true);
    cooldown?.restart();
    expect(cooldown?.remainingSeconds.value).toBe(60);
    scope.stop();
  });
});
