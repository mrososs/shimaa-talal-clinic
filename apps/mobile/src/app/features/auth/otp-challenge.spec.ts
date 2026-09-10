import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearOtpChallenge,
  readOtpChallenge,
  saveOtpChallenge,
} from './otp-challenge';

describe('phone OTP challenge storage', () => {
  beforeEach(clearOtpChallenge);

  it('round-trips only the phone and issue time in session storage', () => {
    saveOtpChallenge('+201012345678', 1_800_000_000_000);
    expect(readOtpChallenge()).toEqual({
      phone: '+201012345678',
      issuedAt: 1_800_000_000_000,
    });
  });

  it('clears the challenge after verification', () => {
    saveOtpChallenge('+201012345678');
    clearOtpChallenge();
    expect(readOtpChallenge()).toBeNull();
  });

  it('refuses malformed persisted data', () => {
    sessionStorage.setItem(
      'clinic.mobile.phone-otp',
      JSON.stringify({ phone: '01012345678', issuedAt: 'yesterday' }),
    );
    expect(readOtpChallenge()).toBeNull();
  });
});
