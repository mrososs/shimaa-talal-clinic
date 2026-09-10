import { computed, readonly, shallowRef } from 'vue';
import type {
  ParentPaymentOption,
  ParentPaymentsView,
  PaymentRecord,
} from '@clinic/contracts';
import { createSequence, usePolling } from '@clinic/client-ui';
import { paymentsApi } from '../../../runtime';
import { apiMessage } from '../../../shared/messages';

export const PAYMENTS_POLL_MS = 15_000;
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const RECEIPT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/** Guardian payment state; identity and prices are read-only API data. */
export function useParentPayments(initialAppointmentId?: () => string | null) {
  const view = shallowRef<ParentPaymentsView>({
    items: [],
    payableAppointments: [],
    instapayHandle: null,
  });
  const selectedId = shallowRef<string | null>(null);
  const loading = shallowRef(true);
  const working = shallowRef(false);
  const failure = shallowRef<string | null>(null);
  const success = shallowRef<string | null>(null);
  const lastResult = shallowRef<{
    payment: PaymentRecord;
    appointment: ParentPaymentOption;
  } | null>(null);
  const sequence = createSequence();
  const pendingKeys = new Map<string, string>();

  const selected = computed<ParentPaymentOption | null>(
    () =>
      view.value.payableAppointments.find(
        (option) => option.appointmentId === selectedId.value,
      ) ?? null,
  );

  function reconcileSelection(): void {
    if (selected.value !== null) return;
    const preferred = initialAppointmentId?.();
    selectedId.value =
      view.value.payableAppointments.find(
        (option) => option.appointmentId === preferred,
      )?.appointmentId ??
      view.value.payableAppointments[0]?.appointmentId ??
      null;
  }

  async function read(): Promise<void> {
    const ticket = sequence.next();
    const next = await paymentsApi.view();
    if (!sequence.accept(ticket)) return;
    view.value = next;
    reconcileSelection();
  }

  async function refresh(): Promise<void> {
    failure.value = null;
    try {
      await read();
    } catch (error) {
      failure.value = apiMessage(error);
    }
  }

  const polling = usePolling(
    async () => {
      try {
        await read();
        failure.value = null;
      } catch (error) {
        failure.value = apiMessage(error);
      }
    },
    { intervalMs: PAYMENTS_POLL_MS, onResume: () => void refresh() },
  );

  async function open(): Promise<void> {
    loading.value = view.value.items.length === 0;
    await refresh();
    loading.value = false;
    polling.start();
  }

  function close(): void {
    polling.stop();
  }

  function select(appointmentId: string): void {
    selectedId.value = appointmentId;
    success.value = null;
    lastResult.value = null;
  }

  async function run(
    method: 'cash' | 'instapay',
    command: (input: {
      appointmentId: string;
      idempotencyKey: string;
    }) => Promise<PaymentRecord>,
  ): Promise<boolean> {
    const appointmentId = selectedId.value;
    const appointment = selected.value;
    if (working.value || appointmentId === null || appointment === null) {
      return false;
    }
    working.value = true;
    failure.value = null;
    success.value = null;
    const requestKey = `${method}:${appointmentId}`;
    const idempotencyKey = pendingKeys.get(requestKey) ?? crypto.randomUUID();
    pendingKeys.set(requestKey, idempotencyKey);
    try {
      const payment = await command({ appointmentId, idempotencyKey });
      pendingKeys.delete(requestKey);
      success.value =
        method === 'cash'
          ? 'تم تسجيل اختيار الدفع في العيادة.'
          : 'تم إرسال الإيصال للمراجعة.';
      lastResult.value = { payment, appointment };
      await read();
      return true;
    } catch (error) {
      failure.value = apiMessage(error);
      await read().catch(() => undefined);
      return false;
    } finally {
      working.value = false;
    }
  }

  function registerCash(): Promise<boolean> {
    return run('cash', (input) => paymentsApi.cash(input));
  }

  function registerInstapay(file: File | null): Promise<boolean> {
    if (view.value.instapayHandle === null) {
      failure.value =
        'الدفع عبر InstaPay غير متاح حالياً. اختاري الدفع في العيادة.';
      return Promise.resolve(false);
    }
    if (
      file === null ||
      file.size < 1 ||
      file.size > MAX_RECEIPT_BYTES ||
      !RECEIPT_TYPES.has(file.type)
    ) {
      failure.value = 'اختاري إيصال PDF أو صورة بحجم لا يزيد عن ٥ ميجابايت.';
      return Promise.resolve(false);
    }
    return run('instapay', (input) => paymentsApi.instapay(input, file));
  }

  return {
    view: readonly(view),
    selectedId: readonly(selectedId),
    selected,
    loading: readonly(loading),
    working: readonly(working),
    failure: readonly(failure),
    success: readonly(success),
    lastResult: readonly(lastResult),
    polling,
    open,
    close,
    refresh,
    select,
    registerCash,
    registerInstapay,
  };
}

export type ParentPaymentsState = ReturnType<typeof useParentPayments>;
