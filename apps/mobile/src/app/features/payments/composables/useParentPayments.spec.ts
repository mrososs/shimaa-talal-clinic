import { effectScope } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParentPaymentsView } from '@clinic/contracts';

const api = {
  view: vi.fn(),
  cash: vi.fn(),
  instapay: vi.fn(),
};
vi.mock('../../../runtime', () => ({ paymentsApi: api }));

const { useParentPayments } = await import('./useParentPayments');

const paymentView = (): ParentPaymentsView => ({
  items: [],
  payableAppointments: [
    {
      appointmentId: 'appointment-1',
      childId: 'child-1',
      childName: 'لين',
      visitType: 'new_visit',
      appointmentStatus: 'confirmed',
      windowStart: '2026-09-17T08:00:00.000Z',
      amountMinor: 45000,
      currency: 'EGP',
    },
  ],
});

function mount(preferred?: string) {
  const scope = effectScope();
  const state = scope.run(() => useParentPayments(() => preferred ?? null));
  if (!state) throw new Error('scope did not run');
  return { state, dispose: () => scope.stop() };
}

describe('useParentPayments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.view.mockResolvedValue(paymentView());
    api.cash.mockResolvedValue({ id: 'payment-1' });
    api.instapay.mockResolvedValue({ id: 'payment-1' });
  });

  it('selects the route appointment from the server-owned payable list', async () => {
    const { state, dispose } = mount('appointment-1');
    await state.open();
    expect(state.selected.value?.amountMinor).toBe(45000);
    expect(state.polling.active.value).toBe(true);
    dispose();
  });

  it('keeps the same cash idempotency key after an uncertain failure', async () => {
    const { state, dispose } = mount();
    await state.open();
    api.cash.mockRejectedValueOnce(new Error('response lost'));

    expect(await state.registerCash()).toBe(false);
    expect(await state.registerCash()).toBe(true);
    expect(api.cash.mock.calls[0][0].idempotencyKey).toBe(
      api.cash.mock.calls[1][0].idempotencyKey,
    );
    dispose();
  });

  it('blocks a duplicate payment tap while the first request is running', async () => {
    let finish!: (value: unknown) => void;
    api.cash.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const { state, dispose } = mount();
    await state.open();

    const first = state.registerCash();
    expect(await state.registerCash()).toBe(false);
    expect(api.cash).toHaveBeenCalledTimes(1);
    finish({ id: 'payment-1' });
    expect(await first).toBe(true);
    dispose();
  });

  it('rejects an invalid receipt before sending it', async () => {
    const { state, dispose } = mount();
    await state.open();

    const invalid = new File(['text'], 'receipt.txt', { type: 'text/plain' });
    expect(await state.registerInstapay(invalid)).toBe(false);
    expect(api.instapay).not.toHaveBeenCalled();
    expect(state.failure.value).toContain('PDF');
    dispose();
  });
});
