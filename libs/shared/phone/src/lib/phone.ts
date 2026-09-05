/**
 * E.164 phone normalisation — the one place a phone number is parsed.
 *
 * Phone is the clinic's lookup key, not an authentication identity: a
 * receptionist types `0101 234 5678` on a call and must land on the guardian
 * stored as `+201012345678`. That only works if every entry point agrees on
 * what the canonical form is, so the rule lives here and is called once per
 * direction — on the way in at the API's DTO boundary, on the way out when a
 * screen renders a number. Never in a controller body, never in a component.
 *
 * `platform:shared`, so this stays framework-free and runs in Node and in both
 * browsers alike.
 *
 * Deliberately not a phone-number library. Validation here is shape-level:
 * length, country code, and the leading digits that distinguish mobile from
 * landline. It is not a carrier-prefix table and does not try to be — a
 * lookup key that rejects a real patient's number is worse than one that
 * accepts an implausible one. If coverage ever needs to be genuinely global,
 * `libphonenumber-js` is the drop-in and is permitted under the
 * `platform:shared` import ban.
 */

/** Regions this clinic platform can parse. Sourced from `clinics.default_country_code`. */
export const PhoneRegion = {
  Egypt: 'EG',
  SaudiArabia: 'SA',
} as const;

export type PhoneRegion = (typeof PhoneRegion)[keyof typeof PhoneRegion];

interface RegionRule {
  /** Country calling code, digits only, no leading `+`. */
  readonly callingCode: string;
  /** Dialled before the national number on a domestic call. */
  readonly trunkPrefix: string;
  /** Accepts a national significant number, i.e. after the trunk prefix is removed. */
  readonly nationalNumber: RegExp;
  /** Digit group sizes for display, keyed by national-number length. */
  readonly displayGroups: Readonly<
    Record<number, readonly number[] | undefined>
  >;
}

const REGION_RULES: Readonly<Record<PhoneRegion, RegionRule>> = {
  EG: {
    callingCode: '20',
    trunkPrefix: '0',
    // Mobile is ten digits: an 010/011/012/015 prefix and eight subscriber
    // digits. Landline is nine: a one- or two-digit governorate code and the
    // subscriber number. The lengths differ, so the two never collide.
    nationalNumber: /^(?:1[0125]\d{8}|[1-9]\d{8})$/,
    displayGroups: { 10: [3, 3, 4], 9: [1, 4, 4] },
  },
  SA: {
    callingCode: '966',
    trunkPrefix: '0',
    // Mobile 5X, landline 1X — both nine digits.
    nationalNumber: /^[15]\d{8}$/,
    displayGroups: { 9: [2, 3, 4] },
  },
};

/**
 * Characters a person plausibly types as separators. Anything else — a letter,
 * an extension, a comment — means we cannot be confident what the number is,
 * so we refuse rather than guess at a value that will become a lookup key.
 */
const TYPEABLE = /^\+?[\d\s\-().]*$/;

/** E.164: 15 digits maximum, and a country code never starts with zero. */
const E164_DIGITS = /^[1-9]\d{6,14}$/;

/** Narrow a `text` column or a request field to a region this library knows. */
export function isPhoneRegion(
  value: string | null | undefined,
): value is PhoneRegion {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(REGION_RULES, value)
  );
}

/**
 * Canonicalise anything a person might type into E.164, or return `null` when
 * it cannot be one.
 *
 * Understands four shapes, in the order a human is likely to produce them:
 * an international number (`+20 101 234 5678`), an international call prefix
 * (`0020…`), a domestic number with its trunk prefix (`01012345678`), and a
 * bare national number (`1012345678`).
 *
 * Idempotent: feeding it its own output returns that output unchanged.
 */
export function normalizeToE164(
  input: string | null | undefined,
  defaultRegion: PhoneRegion,
): string | null {
  if (typeof input !== 'string') return null;

  const trimmed = input.trim();
  if (trimmed === '' || !TYPEABLE.test(trimmed)) return null;

  const digits = trimmed.replace(/\D/g, '');
  if (digits === '') return null;

  const rule = REGION_RULES[defaultRegion];
  if (rule === undefined) return null;

  let candidate: string;

  if (trimmed.startsWith('+')) {
    candidate = digits;
  } else if (digits.startsWith('00')) {
    candidate = digits.slice(2);
  } else if (digits.startsWith(rule.trunkPrefix)) {
    candidate = rule.callingCode + digits.slice(rule.trunkPrefix.length);
  } else if (
    digits.startsWith(rule.callingCode) &&
    rule.nationalNumber.test(digits.slice(rule.callingCode.length))
  ) {
    // The country code, typed without a '+'. Only read it that way when what
    // follows is a valid national number, so a domestic number that merely
    // happens to start with those digits is not mangled.
    candidate = digits;
  } else {
    candidate = rule.callingCode + digits;
  }

  if (!E164_DIGITS.test(candidate)) return null;

  // A number from a region we know must look like one. A number from a region
  // we do not know is accepted on E.164 shape alone — refusing it would make
  // the platform unusable the day a clinic opens outside the pilot country.
  const known = findRegion(candidate);
  if (
    known !== undefined &&
    !known.nationalNumber.test(candidate.slice(known.callingCode.length))
  ) {
    return null;
  }

  return `+${candidate}`;
}

/**
 * Render a stored E.164 number for a human, grouped by the conventions of its
 * own region. Anything unrecognised is returned untouched — a display helper
 * must never lose information.
 */
export function formatForDisplay(e164: string | null | undefined): string {
  if (typeof e164 !== 'string' || !e164.startsWith('+')) return e164 ?? '';

  const digits = e164.slice(1);
  const rule = findRegion(digits);
  if (rule === undefined) return e164;

  const national = digits.slice(rule.callingCode.length);
  const groups = rule.displayGroups[national.length];
  if (groups === undefined) return `+${rule.callingCode} ${national}`;

  const parts: string[] = [];
  let offset = 0;
  for (const size of groups) {
    parts.push(national.slice(offset, offset + size));
    offset += size;
  }
  if (offset < national.length) parts.push(national.slice(offset));

  return `+${rule.callingCode} ${parts.join(' ')}`;
}

/** Longest calling code first, so a shorter code can never shadow a longer one. */
const RULES_BY_CODE_LENGTH: readonly RegionRule[] = Object.values(
  REGION_RULES,
).sort((a, b) => b.callingCode.length - a.callingCode.length);

function findRegion(e164Digits: string): RegionRule | undefined {
  return RULES_BY_CODE_LENGTH.find((rule) =>
    e164Digits.startsWith(rule.callingCode),
  );
}
