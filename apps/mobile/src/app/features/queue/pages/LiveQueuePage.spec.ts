import { mount } from '@vue/test-utils';
import { computed, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { AppointmentStatus, type ParentQueueItem } from '@clinic/contracts';

const pendingItem = {
  childId: 'child-1',
  childName: 'لين',
  appointment: {
    id: 'appointment-1',
    status: AppointmentStatus.Requested,
  },
  queueEntry: null,
  session: {
    status: 'open',
    doctorPresence: 'arrived',
    delayMinutes: null,
    avgConsultMinutes: 6,
    revision: 7,
  },
} as ParentQueueItem;

const items = ref<ParentQueueItem[]>([pendingItem]);
const queue = {
  items,
  expected: computed(() =>
    items.value.filter((item) => item.queueEntry === null),
  ),
  session: computed(() => items.value[0]?.session ?? null),
  loading: ref(false),
  refreshing: ref(false),
  failure: ref<string | null>(null),
  deferring: ref<string | null>(null),
  open: vi.fn(),
  close: vi.fn(),
  refresh: vi.fn(),
  defer: vi.fn(),
};

vi.mock('@ionic/vue', async (load) => {
  const actual = await load<typeof import('@ionic/vue')>();
  return {
    ...actual,
    onIonViewWillEnter: (callback: () => void) => callback(),
    onIonViewDidLeave: vi.fn(),
  };
});
vi.mock('../composables/useLiveQueue', () => ({
  useLiveQueue: () => queue,
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../../payments/composables/useParentPayments', () => ({
  useParentPayments: () => ({
    view: ref({ items: [], payableAppointments: [], instapayHandle: null }),
    open: vi.fn(),
    close: vi.fn(),
  }),
}));
vi.mock('../../../runtime', () => ({
  session: {
    state: {
      identity: {
        clinic: { gracePeriodMinutes: 10, maxSelfDefers: 2 },
      },
    },
  },
}));

const LiveQueuePage = (await import('./LiveQueuePage.vue')).default;

describe('LiveQueuePage', () => {
  it('renders a requested appointment as pending approval, not an empty queue', () => {
    const wrapper = mount(LiveQueuePage, {
      global: {
        stubs: {
          ClinicDialog: true,
          IonButton: true,
          IonIcon: true,
          IonSpinner: true,
          RouterLink: true,
          ScreenShell: {
            template: '<main><slot name="header-end" /><slot /></main>',
          },
          SessionBanner: true,
          TurnCard: true,
        },
      },
    });

    expect(wrapper.text()).toContain('حجز لين قيد المراجعة');
    expect(wrapper.text()).toContain('بانتظار موافقة العيادة');
    expect(wrapper.text()).not.toContain('لم يتم تسجيل الوصول بعد');
    expect(wrapper.find('.pending-card').attributes('aria-live')).toBe(
      'polite',
    );
  });
});
