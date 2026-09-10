import { effectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@clinic/api-client';
import type {
  MessageInbox,
  MessageThreadDetail,
  MessageThreadSummary,
} from '@clinic/contracts';

const api = {
  inbox: vi.fn(),
  detail: vi.fn(),
  markRead: vi.fn(),
  reply: vi.fn(),
  close: vi.fn(),
  reopen: vi.fn(),
  assignToDoctor: vi.fn(),
  raiseUrgent: vi.fn(),
  rejectUrgent: vi.fn(),
  acceptUrgent: vi.fn(),
};

vi.mock('../../../runtime', () => ({ messagesApi: api }));

const { useMessagesInbox } = await import('./useMessagesInbox');

/**
 * The inbox's behaviour, without a browser or a server.
 *
 * The properties that matter are the live ones: a family's reply must appear
 * without anybody reloading, and neither a slow answer nor a failed tick may
 * disturb the conversation somebody is reading.
 */
describe('useMessagesInbox', () => {
  const thread = (over: Partial<MessageThreadSummary> = {}): MessageThreadSummary =>
    ({
      id: 'thread-1',
      guardianId: 'guardian-1',
      childId: 'child-1',
      contactName: 'أم لين',
      childName: 'لين',
      subject: 'سؤال عن الجرعة',
      status: 'open',
      priority: 'normal',
      assignedMemberId: null,
      assignedMemberName: null,
      lastMessagePreview: 'شكرًا',
      lastMessageAt: '2026-09-09T08:00:00.000Z',
      unreadCount: 0,
      urgentCase: null,
      ...over,
    }) as MessageThreadSummary;

  const detail = (over: Partial<MessageThreadDetail> = {}): MessageThreadDetail =>
    ({
      ...thread(),
      messages: [
        {
          id: 'message-1',
          threadId: 'thread-1',
          senderType: 'guardian',
          senderName: 'أم لين',
          body: 'الحرارة ٣٨',
          createdAt: '2026-09-09T08:00:00.000Z',
        },
      ],
      ...over,
    }) as MessageThreadDetail;

  const inbox = (over: Partial<MessageInbox> = {}): MessageInbox => ({
    threads: [thread()],
    templates: [{ id: 'template-1', title: 'تعليمات الخافض', body: 'كل ٦ ساعات' }],
    totalUnread: 0,
    ...over,
  });

  function mount() {
    const scope = effectScope();
    const state = scope.run(() => useMessagesInbox());
    if (state === undefined) throw new Error('scope did not run');
    return { state, dispose: () => scope.stop() };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    api.inbox.mockResolvedValue(inbox());
    api.detail.mockResolvedValue(detail());
    api.markRead.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the first conversation on the first read', async () => {
    const { state, dispose } = mount();

    await state.start();

    expect(api.inbox).toHaveBeenCalledWith('all');
    expect(state.selected.value?.id).toBe('thread-1');
    expect(state.loading.value).toBe(false);
    dispose();
  });

  it('marks a conversation read only when it is the one on screen', async () => {
    api.inbox.mockResolvedValue(inbox({ threads: [thread({ unreadCount: 2 })] }));
    api.detail.mockResolvedValue(detail({ unreadCount: 2 }));
    const { state, dispose } = mount();

    await state.start();

    expect(api.markRead).toHaveBeenCalledWith('thread-1');
    // The counter clears in both places at once: the badge in the list is the
    // same fact as the conversation header.
    expect(state.selected.value?.unreadCount).toBe(0);
    expect(state.totalUnread.value).toBe(0);
    dispose();
  });

  it('counts unread across the list', async () => {
    api.inbox.mockResolvedValue(
      inbox({
        threads: [
          thread({ id: 'a', unreadCount: 2 }),
          thread({ id: 'b', unreadCount: 3 }),
        ],
      }),
    );
    api.detail.mockResolvedValue(detail({ id: 'a', unreadCount: 0 }));
    const { state, dispose } = mount();

    await state.start();

    expect(state.totalUnread.value).toBe(5);
    dispose();
  });

  it('drops the open conversation when it leaves the filter', async () => {
    const { state, dispose } = mount();
    await state.start();
    expect(state.selected.value?.id).toBe('thread-1');

    // Closed elsewhere, and "المفتوحة" no longer contains it.
    api.inbox.mockResolvedValue(inbox({ threads: [] }));
    await state.setFilter('open');

    expect(state.filter.value).toBe('open');
    expect(api.inbox).toHaveBeenLastCalledWith('open');
    expect(state.selected.value).toBeNull();
    dispose();
  });

  describe('staying current on its own', () => {
    it('polls at the desk cadence without anybody asking', async () => {
      vi.useFakeTimers();
      const { state, dispose } = mount();
      await state.start();
      api.inbox.mockClear();

      await vi.advanceTimersByTimeAsync(15_000);

      expect(api.inbox).toHaveBeenCalledTimes(3);
      dispose();
    });

    it("shows a family's reply with no user action", async () => {
      vi.useFakeTimers();
      const { state, dispose } = mount();
      await state.start();
      expect(state.selected.value?.messages).toHaveLength(1);

      api.detail.mockResolvedValue(
        detail({
          messages: [
            ...detail().messages,
            {
              id: 'message-2',
              threadId: 'thread-1',
              senderType: 'guardian',
              senderName: 'أم لين',
              body: 'ارتفعت إلى ٣٩',
              createdAt: '2026-09-09T08:05:00.000Z',
            },
          ],
        }),
      );
      await vi.advanceTimersByTimeAsync(5_000);

      expect(state.selected.value?.messages).toHaveLength(2);
      dispose();
    });

    it('refreshes at once after this desk replies, without waiting for a tick', async () => {
      vi.useFakeTimers();
      const { state, dispose } = mount();
      await state.start();
      api.inbox.mockClear();
      api.reply.mockResolvedValue({ id: 'message-2' });

      await state.reply('تمام، تابعي الحرارة');

      expect(api.reply).toHaveBeenCalledWith(
        'thread-1',
        'تمام، تابعي الحرارة',
        expect.any(String),
      );
      // No timer was advanced. The inbox is already current.
      expect(api.inbox).toHaveBeenCalledTimes(1);
      dispose();
    });

    it('never blanks the inbox for a background refresh', async () => {
      vi.useFakeTimers();
      const { state, dispose } = mount();
      await state.start();
      expect(state.loading.value).toBe(false);

      let release: ((value: unknown) => void) | undefined;
      api.inbox.mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      await vi.advanceTimersByTimeAsync(5_000);

      expect(state.loading.value).toBe(false);
      expect(state.threads.value).toHaveLength(1);

      release?.(inbox());
      dispose();
    });

    it('keeps the conversation on screen when a poll fails', async () => {
      vi.useFakeTimers();
      const { state, dispose } = mount();
      await state.start();

      api.inbox.mockRejectedValueOnce(
        new ApiClientError(0, { code: 'network', message: 'offline' }),
      );
      await vi.advanceTimersByTimeAsync(5_000);

      expect(state.threads.value).toHaveLength(1);
      expect(state.selected.value?.id).toBe('thread-1');
      expect(state.failure.value).not.toBeNull();
      dispose();
    });

    it('never lets a slow answer undo a fresh one', async () => {
      const { state, dispose } = mount();
      await state.start();

      let releaseSlow: ((value: unknown) => void) | undefined;
      api.inbox.mockReturnValueOnce(
        new Promise((resolve) => {
          releaseSlow = resolve;
        }),
      );
      const slow = state.refresh();

      api.inbox.mockResolvedValueOnce(
        inbox({ threads: [thread({ id: 'newer', subject: 'الأحدث' })] }),
      );
      await state.refresh();
      expect(state.threads.value[0].id).toBe('newer');

      releaseSlow?.(inbox({ threads: [thread({ id: 'older' })] }));
      await slow;

      expect(state.threads.value[0].id).toBe('newer');
      dispose();
    });

    it('stops when the screen is torn down', async () => {
      vi.useFakeTimers();
      const { state, dispose } = mount();
      await state.start();
      const before = api.inbox.mock.calls.length;

      dispose();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(api.inbox.mock.calls.length).toBe(before);
    });
  });

  it('re-reads after a command that somebody else beat it to', async () => {
    const { state, dispose } = mount();
    await state.start();
    api.inbox.mockClear();
    api.close.mockRejectedValue(
      new ApiClientError(409, {
        code: 'message_thread_closed',
        message: 'Already closed.',
      }),
    );

    await state.close();

    expect(state.failure.value).not.toBeNull();
    // It says what happened, then shows what is true now.
    expect(api.inbox).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('runs one command at a time', async () => {
    const { state, dispose } = mount();
    await state.start();

    let release: (() => void) | undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.close.mockReturnValue(slow);
    api.reopen.mockResolvedValue(thread());

    const first = state.close();
    const second = state.reopen();
    await second;

    expect(api.reopen).not.toHaveBeenCalled();
    expect(state.working.value).toBe(true);
    release?.();
    await first;
    expect(state.working.value).toBe(false);
    dispose();
  });
});
