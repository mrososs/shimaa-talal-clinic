/**
 * The single seam a payment provider will be plugged into.
 *
 * No provider is integrated — there is no HyperPay, Moyasar, Stripe or Tap
 * code anywhere in this repository, and there should not be until the payments
 * domain is actually built. Declaring the token and the marker interface now
 * means the eventual integration has exactly one place to land, and that the
 * rest of the platform can only ever see `PaymentStatus` from
 * `@clinic/contracts` — never a provider's own vocabulary.
 *
 * Phase 2 adds the operations (create intent, verify, refund) to this
 * interface, one at a time, driven by real requirements.
 */
export interface PaymentProvider {
  /** Stable identifier used in payment records, e.g. `'moyasar'`. */
  readonly name: string;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
