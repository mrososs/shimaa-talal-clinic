import type { ApiClient } from '@clinic/api-client';
import type {
  PaymentReceiptDownload,
  PaymentRecord,
  PaymentsDashboard,
  RegisterPaymentInput,
} from '@clinic/contracts';

export function createPaymentsApi(client: ApiClient) {
  return {
    list: (): Promise<PaymentsDashboard> => client.get('clinic/payments'),
    cash: (input: RegisterPaymentInput): Promise<PaymentRecord> =>
      client.post('clinic/payments/cash', input),
    instapay: (
      input: RegisterPaymentInput,
      file: File,
    ): Promise<PaymentRecord> => {
      const form = new FormData();
      for (const [key, value] of Object.entries(input))
        form.append(key, String(value));
      form.append('file', file);
      return client.post('clinic/payments/instapay', form);
    },
    approve: (id: string, note?: string): Promise<PaymentRecord> =>
      client.post(`clinic/payments/${id}/approve`, { note }),
    reject: (id: string, note?: string): Promise<PaymentRecord> =>
      client.post(`clinic/payments/${id}/reject`, { note }),
    refund: (id: string, note?: string): Promise<PaymentRecord> =>
      client.post(`clinic/payments/${id}/refund`, { note }),
    receipt: (id: string): Promise<PaymentReceiptDownload> =>
      client.get(`clinic/payments/${id}/receipt`),
  };
}
export type PaymentsApi = ReturnType<typeof createPaymentsApi>;
