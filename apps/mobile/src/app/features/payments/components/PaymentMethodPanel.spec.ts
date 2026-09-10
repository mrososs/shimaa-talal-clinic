import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ParentPaymentOption } from '@clinic/contracts';
import PaymentMethodPanel from './PaymentMethodPanel.vue';

const appointment: ParentPaymentOption = {
  appointmentId: 'appointment-1',
  childId: 'child-1',
  childName: 'لين',
  visitType: 'new_visit',
  appointmentStatus: 'confirmed',
  windowStart: '2026-09-17T08:00:00.000Z',
  amountMinor: 45000,
  currency: 'EGP',
};

function mountPanel(instapayHandle: string | null) {
  return mount(PaymentMethodPanel, {
    props: { appointment, instapayHandle, working: false },
    global: { stubs: { IonIcon: true, IonSpinner: true } },
  });
}

describe('PaymentMethodPanel', () => {
  it('shows the server-owned destination and requires a receipt before upload', async () => {
    const wrapper = mountPanel('payments@clinic.instapay');

    expect(wrapper.text()).toContain('payments@clinic.instapay');
    const submit = wrapper.get('.payment-submit');
    expect(submit.attributes('disabled')).toBeDefined();

    const receipt = new File(['receipt'], 'receipt.png', { type: 'image/png' });
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [receipt],
    });
    await input.trigger('change');
    await submit.trigger('click');

    expect(wrapper.emitted('instapay')).toEqual([[receipt]]);
  });

  it('falls back to cash when the clinic has not configured InstaPay', async () => {
    const wrapper = mountPanel(null);
    const methods = wrapper.findAll('.method');

    expect(methods[0]?.attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('غير متاح حتى تضبطه العيادة');
    expect(wrapper.get('.payment-submit').text()).toContain('الدفع نقداً');

    await wrapper.get('.payment-submit').trigger('click');
    expect(wrapper.emitted('cash')).toHaveLength(1);
    expect(wrapper.emitted('instapay')).toBeUndefined();
  });
});
