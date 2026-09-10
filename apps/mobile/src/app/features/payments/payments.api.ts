import type { ApiClient } from '@clinic/api-client';
import type {
  ParentPaymentsView,
  PaymentRecord,
  RegisterParentPaymentInput,
} from '@clinic/contracts';

export function createParentPaymentsApi(client: ApiClient) {
  return {
    view: (): Promise<ParentPaymentsView> =>
      client.get<ParentPaymentsView>('payments'),

    cash: (input: RegisterParentPaymentInput): Promise<PaymentRecord> =>
      client.post<PaymentRecord>('payments/cash', input),

    instapay: (
      input: RegisterParentPaymentInput,
      file: File,
    ): Promise<PaymentRecord> => {
      const body = new FormData();
      body.append('appointmentId', input.appointmentId);
      body.append('idempotencyKey', input.idempotencyKey);
      body.append('file', file, file.name);
      return client.post<PaymentRecord>('payments/instapay', body);
    },
  };
}

export type ParentPaymentsApi = ReturnType<typeof createParentPaymentsApi>;
