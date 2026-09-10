import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { QueueBoardEntry } from '@clinic/contracts';
import QueueList from './QueueList.vue';

const waiting = {
  id: 'entry-1',
  ticketNumber: 4,
  status: 'waiting',
  source: 'walk_in',
  deferCount: 0,
  isEmergency: false,
  child: { id: 'child-1', fullName: 'لين أحمد', dateOfBirth: null, sex: null },
  guardian: {
    id: 'guardian-1',
    fullName: 'سارة أحمد',
    phoneE164: '+201000000000',
  },
} as QueueBoardEntry;

function labels(
  canManage: boolean,
  canCall: boolean,
  canRecordMeasurements = false,
): string[] {
  const wrapper = mount(QueueList, {
    props: {
      entries: [waiting],
      canManage,
      canCall,
      canRecordMeasurements,
      working: null,
    },
  });
  return wrapper.findAll('button').map((button) => button.text());
}

describe('QueueList permissions', () => {
  it('keeps desk-only row commands out of the narrowed doctor view', () => {
    expect(labels(false, false)).toEqual([]);
  });

  it('shows the explicit desk commands to reception and admin', () => {
    const buttons = labels(true, true, true);
    expect(buttons).toContain('نداء');
    expect(buttons).toContain('تسجيل القياسات');
    expect(buttons).toContain('عاجل');
    expect(buttons).toContain('إزالة');
  });

  it('can expose measurement capture without exposing desk commands', () => {
    expect(labels(false, false, true)).toEqual(['تسجيل القياسات']);
  });
});
