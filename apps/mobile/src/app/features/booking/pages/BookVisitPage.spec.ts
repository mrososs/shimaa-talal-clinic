import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  availability: vi.fn(),
  book: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@ionic/vue', async (load) => {
  const actual = await load<typeof import('@ionic/vue')>();
  return {
    ...actual,
    onIonViewWillEnter: (callback: () => void) => callback(),
  };
});
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
}));
vi.mock('../../../runtime', () => ({
  bookingApi: {
    availability: mocks.availability,
    book: mocks.book,
  },
  session: {
    state: reactive({
      identity: {
        clinic: { timezone: 'Africa/Cairo' },
        children: [
          {
            id: 'child-1',
            clinicId: 'clinic-1',
            fullName: 'لين',
            dateOfBirth: '2022-03-14',
            sex: 'female',
            relationship: 'mother',
            isPrimary: true,
          },
        ],
      },
    }),
  },
}));

const BookVisitPage = (await import('./BookVisitPage.vue')).default;

describe('BookVisitPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.availability.mockResolvedValue([
      {
        date: '2026-09-17',
        windows: [
          {
            sessionId: 'session-1',
            sessionKind: 'morning',
            windowStart: '2026-09-17T08:00:00.000Z',
            windowEnd: '2026-09-17T09:00:00.000Z',
            capacity: 5,
            taken: 2,
            remaining: 3,
          },
        ],
      },
    ]);
    mocks.book.mockResolvedValue({ id: 'appointment-1' });
  });

  it('matches the prototype flow and continues to server-priced payment', async () => {
    const wrapper = mount(BookVisitPage, {
      global: {
        stubs: {
          IonIcon: true,
          IonSpinner: true,
          IonPage: { template: '<div><slot /></div>' },
          IonContent: { template: '<div><slot /></div>' },
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('نوع الحجز');
    expect(wrapper.text()).toContain('من سيزور الطبيبة؟');
    expect(wrapper.text()).toContain('اختر اليوم');
    expect(wrapper.text()).toContain('اختر فترة الحضور');

    await wrapper.get('.window-card').trigger('click');
    await wrapper.get('.continue-button').trigger('click');
    await flushPromises();

    expect(mocks.book).toHaveBeenCalledWith({
      childId: 'child-1',
      sessionId: 'session-1',
      windowStart: '2026-09-17T08:00:00.000Z',
      visitType: 'new_visit',
    });
    expect(mocks.replace).toHaveBeenCalledWith({
      name: 'payments',
      query: { appointmentId: 'appointment-1' },
    });
  });
});
