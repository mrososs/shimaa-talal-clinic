import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../runtime', () => ({
  clinicApi: {
    searchGuardians: vi.fn(),
    guardian: vi.fn(),
  },
}));

import { clinicApi } from '../../../runtime';
import WalkInDialog from './WalkInDialog.vue';

const guardian = {
  id: 'guardian-1',
  clinicId: 'clinic-1',
  fullName: 'سارة أحمد',
  phoneE164: '+201000000000',
  email: null,
  hasAccount: false,
  createdAt: '2026-09-08T08:00:00.000Z',
};

describe('WalkInDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clinicApi.searchGuardians).mockResolvedValue({
      items: [guardian],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    vi.mocked(clinicApi.guardian).mockResolvedValue({
      guardian,
      children: [
        {
          id: 'child-1',
          clinicId: 'clinic-1',
          fullName: 'لين',
          dateOfBirth: null,
          sex: null,
          relationship: 'mother',
          isPrimary: true,
        },
      ],
    });
  });

  it('selects a scoped family and emits a walk-in command', async () => {
    const wrapper = mount(WalkInDialog, {
      props: { open: true, working: false },
      global: {
        stubs: {
          ClinicDialog: {
            props: ['open'],
            template:
              '<div v-if="open"><slot /><slot name="actions" /></div>',
          },
        },
      },
    });

    await wrapper.get('input[type="search"]').setValue('سارة');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await wrapper.get('.walk-in__result').trigger('click');
    await flushPromises();
    await wrapper.get('textarea').setValue('كشف عاجل');
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('إضافة'))
      ?.trigger('click');

    expect(wrapper.emitted('submit')).toEqual([
      [
        {
          childId: 'child-1',
          guardianId: 'guardian-1',
          visitReason: 'كشف عاجل',
        },
      ],
    ]);
  });
});
