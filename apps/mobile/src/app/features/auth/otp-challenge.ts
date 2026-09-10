export interface StoredOtpChallenge {
  phone: string;
  issuedAt: number;
}

const STORAGE_KEY = 'clinic.mobile.phone-otp';

/**
 * Keep the phone only for the lifetime of this browser tab.
 *
 * The OTP page has to survive a refresh, but a phone number should not be put
 * in the URL or long-lived local storage. `sessionStorage` gives us exactly
 * that boundary. Failures are ignored because Capacitor/browser privacy modes
 * may disable storage; the flow still works until a reload.
 */
export function saveOtpChallenge(
  phone: string,
  issuedAt = Date.now(),
): StoredOtpChallenge {
  const challenge = { phone, issuedAt };
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(challenge));
  } catch {
    // Storage is an enhancement, not an authentication authority.
  }
  return challenge;
}

export function readOtpChallenge(): StoredOtpChallenge | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) return null;
    const value = JSON.parse(raw) as Partial<StoredOtpChallenge>;
    return typeof value.phone === 'string' &&
      /^\+[1-9]\d{6,14}$/.test(value.phone) &&
      typeof value.issuedAt === 'number' &&
      Number.isFinite(value.issuedAt)
      ? { phone: value.phone, issuedAt: value.issuedAt }
      : null;
  } catch {
    return null;
  }
}

export function clearOtpChallenge(): void {
  try {
    globalThis.sessionStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing else to clean up.
  }
}
