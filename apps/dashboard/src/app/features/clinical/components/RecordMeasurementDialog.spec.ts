import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import RecordMeasurementDialog from './RecordMeasurementDialog.vue';

describe('RecordMeasurementDialog', () => {
  it('requires one value and emits the available measurements only', async () => {
    const wrapper = mount(RecordMeasurementDialog, {
      attachTo: document.body,
      props: { open: true, childName: 'ليان', working: false },
      global: { stubs: { teleport: true } },
    });

    const save = wrapper.get('button.dbtn--teal');
    await save.trigger('click');
    expect(document.body.textContent).toContain(
      'سجّلي قياسًا واحدًا على الأقل',
    );

    await wrapper.get('input[step="0.1"]').setValue('37.2');
    await save.trigger('click');
    expect(wrapper.emitted('submit')).toEqual([
      [
        {
          weightKg: null,
          heightCm: null,
          headCircumferenceCm: null,
          temperatureC: 37.2,
        },
      ],
    ]);

    wrapper.unmount();
  });
});
