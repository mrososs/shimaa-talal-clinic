import { describe, expect, it } from 'vitest';
import {
  formatForDisplay,
  isPhoneRegion,
  normalizeToE164,
  PhoneRegion,
} from './phone';

describe('normalizeToE164 — Egypt', () => {
  // The shapes a receptionist, a parent and an import file actually produce.
  const EG_MOBILE = '+201012345678';
  it.each([
    ['domestic, trunk prefix', '01012345678'],
    ['domestic, spaced', '010 1234 5678'],
    ['domestic, dashed', '010-1234-5678'],
    ['domestic, parenthesised', '(010) 1234-5678'],
    ['bare national number', '1012345678'],
    ['international', '+201012345678'],
    ['international, spaced', '+20 101 234 5678'],
    ['international access code', '00201012345678'],
    ['country code without a plus', '201012345678'],
    ['surrounding whitespace', '  01012345678  '],
  ])('accepts %s', (_label, input) => {
    expect(normalizeToE164(input, PhoneRegion.Egypt)).toBe(EG_MOBILE);
  });

  it.each([
    ['010', '+201012345678'],
    ['011', '+201112345678'],
    ['012', '+201212345678'],
    ['015', '+201512345678'],
  ])('accepts the %s mobile prefix', (prefix, expected) => {
    expect(normalizeToE164(`${prefix}12345678`, PhoneRegion.Egypt)).toBe(
      expected,
    );
  });

  it('accepts a Cairo landline', () => {
    expect(normalizeToE164('0223456789', PhoneRegion.Egypt)).toBe(
      '+20223456789',
    );
  });

  it('accepts a governorate landline with a two-digit area code', () => {
    expect(normalizeToE164('0133456789', PhoneRegion.Egypt)).toBe(
      '+20133456789',
    );
  });

  it('is idempotent', () => {
    const once = normalizeToE164('010 1234 5678', PhoneRegion.Egypt);
    expect(once).not.toBeNull();
    expect(normalizeToE164(once, PhoneRegion.Egypt)).toBe(once);
  });
});

describe('normalizeToE164 — rejection', () => {
  it.each([
    ['letters', 'abc'],
    ['a number with an extension', '01012345678 ext 12'],
    ['a plus on its own', '+'],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['too short to be a national number', '12345'],
    ['a mobile prefix that does not exist', '01312345678'],
    ['a national number one digit too long', '010123456789'],
    ['more than fifteen digits', '+1234567890123456'],
    ['a country code starting with zero', '+0123456789'],
  ])('rejects %s', (_label, input) => {
    expect(normalizeToE164(input, PhoneRegion.Egypt)).toBeNull();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_label, input) => {
    expect(normalizeToE164(input, PhoneRegion.Egypt)).toBeNull();
  });
});

describe('normalizeToE164 — other regions', () => {
  it('normalises a Saudi mobile against the Saudi region', () => {
    expect(normalizeToE164('0501234567', PhoneRegion.SaudiArabia)).toBe(
      '+966501234567',
    );
  });

  it('accepts an international Saudi number even when the clinic default is Egypt', () => {
    // A guardian may hold a foreign number; the '+' is unambiguous, so the
    // clinic's default region must not override it.
    expect(normalizeToE164('+966501234567', PhoneRegion.Egypt)).toBe(
      '+966501234567',
    );
  });

  it('rejects an international number that is malformed for its own region', () => {
    expect(normalizeToE164('+966201234567', PhoneRegion.Egypt)).toBeNull();
  });

  it('accepts an international number from a region it does not model', () => {
    // Refusing these would make the platform unusable outside the pilot country.
    expect(normalizeToE164('+442071234567', PhoneRegion.Egypt)).toBe(
      '+442071234567',
    );
  });
});

describe('formatForDisplay', () => {
  it.each([
    ['an Egyptian mobile', '+201012345678', '+20 101 234 5678'],
    ['an Egyptian landline', '+20223456789', '+20 2 2345 6789'],
    ['a Saudi mobile', '+966501234567', '+966 50 123 4567'],
  ])('groups %s', (_label, input, expected) => {
    expect(formatForDisplay(input)).toBe(expected);
  });

  it('returns an unmodelled region untouched', () => {
    expect(formatForDisplay('+442071234567')).toBe('+442071234567');
  });

  it.each([
    ['a non-E.164 string', '01012345678'],
    ['an empty string', ''],
  ])('returns %s unchanged rather than losing it', (_label, input) => {
    expect(formatForDisplay(input)).toBe(input);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('renders %s as an empty string', (_label, input) => {
    expect(formatForDisplay(input)).toBe('');
  });

  it('round-trips with normalizeToE164', () => {
    const e164 = normalizeToE164('010 1234 5678', PhoneRegion.Egypt);
    expect(e164).not.toBeNull();
    expect(normalizeToE164(formatForDisplay(e164), PhoneRegion.Egypt)).toBe(
      e164,
    );
  });
});

describe('isPhoneRegion', () => {
  it.each([
    ['EG', true],
    ['SA', true],
    ['eg', false],
    ['US', false],
    ['', false],
  ])('narrows %s to %s', (value, expected) => {
    expect(isPhoneRegion(value)).toBe(expected);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(isPhoneRegion(value)).toBe(false);
  });

  it('does not treat inherited object properties as regions', () => {
    // A `text` column could hold anything; 'constructor' must not pass.
    expect(isPhoneRegion('constructor')).toBe(false);
    expect(isPhoneRegion('toString')).toBe(false);
  });
});
