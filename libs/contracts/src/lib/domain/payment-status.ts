/**
 * States a payment record can be in.
 *
 * Provider-specific vocabulary (HyperPay, Moyasar, Stripe, ...) must never
 * appear here. Providers are translated into these states behind the
 * `PaymentProvider` seam in `libs/server/payments`.
 */
export const PaymentStatus = {
  Pending: 'pending',
  Paid: 'paid',
  Failed: 'failed',
  Refunded: 'refunded',
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];
