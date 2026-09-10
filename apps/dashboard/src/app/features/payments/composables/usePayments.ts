import { readonly, shallowRef } from 'vue';
import type {
  PaymentRecord,
  PaymentsDashboard,
  RegisterPaymentInput,
} from '@clinic/contracts';
import { paymentsApi } from '../../../runtime';
import { apiMessage } from '../../../shared/messages';

export function usePayments() {
  const data = shallowRef<PaymentsDashboard | null>(null),
    loading = shallowRef(true),
    working = shallowRef<string | null>(null),
    failure = shallowRef<string | null>(null);
  async function load() {
    loading.value = true;
    try {
      data.value = await paymentsApi.list();
      failure.value = null;
    } catch (e) {
      failure.value = apiMessage(e);
    } finally {
      loading.value = false;
    }
  }
  async function command(key: string, work: () => Promise<PaymentRecord>) {
    working.value = key;
    try {
      await work();
      await load();
    } catch (e) {
      failure.value = apiMessage(e);
    } finally {
      working.value = null;
    }
  }
  return {
    data: readonly(data),
    loading: readonly(loading),
    working: readonly(working),
    failure: readonly(failure),
    load,
    cash: (i: RegisterPaymentInput) =>
      command('create', () => paymentsApi.cash(i)),
    instapay: (i: RegisterPaymentInput, f: File) =>
      command('create', () => paymentsApi.instapay(i, f)),
    approve: (id: string) => command(id, () => paymentsApi.approve(id)),
    reject: (id: string) => command(id, () => paymentsApi.reject(id)),
    refund: (id: string) => command(id, () => paymentsApi.refund(id)),
  };
}
