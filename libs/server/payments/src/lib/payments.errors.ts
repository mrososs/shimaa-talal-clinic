export const PaymentsErrorCode = {
  NotFound: 'payment_not_found',
  InvalidTransition: 'payment_invalid_transition',
  InvalidReceipt: 'payment_invalid_receipt',
  StorageFailed: 'payment_storage_failed',
} as const;

export type PaymentsErrorCode =
  (typeof PaymentsErrorCode)[keyof typeof PaymentsErrorCode];

export class PaymentsError extends Error {
  constructor(
    readonly code: PaymentsErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PaymentsError';
  }
}
