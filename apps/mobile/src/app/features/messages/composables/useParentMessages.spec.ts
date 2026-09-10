import { effectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MessageThreadDetail,
  MessageThreadSummary,
} from '@clinic/contracts';

const api = {
  inbox: vi.fn(),
  create: vi.fn(),
  detail: vi.fn(),
  reply: vi.fn(),
  markRead: vi.fn(),
  raiseUrgent: vi.fn(),
};
vi.mock('../../../runtime', () => ({ messagesApi: api }));

const { PARENT_MESSAGES_POLL_MS, useParentMessages } =
  await import('./useParentMessages');

function summary(
  overrides: Partial<MessageThreadSummary> = {},
): MessageThreadSummary {
  return {
    id: 'thread-1',
    guardianId: 'guardian-1',
    childId: 'child-1',
    contactName: 'أم لين',
    childName: 'لين',
    subject: 'الحرارة',
    status: 'open',
    priority: 'normal',
    assignedMemberId: null,
    assignedMemberName: null,
    lastMessagePreview: 'وصلت الرسالة',
    lastMessageAt: '2026-09-10T10:00:00.000Z',
    unreadCount: 0,
    urgentCase: null,
    ...overrides,
  };
}

function detail(
  overrides: Partial<MessageThreadDetail> = {},
): MessageThreadDetail {
  return {
    ...summary(),
    messages: [
      {
        id: 'message-1',
        threadId: 'thread-1',
        senderType: 'guardian',
        senderName: 'أم لين',
        body: 'الحرارة مرتفعة',
        createdAt: '2026-09-10T10:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useParentMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.inbox.mockResolvedValue({ threads: [summary()], totalUnread: 0 });
    api.detail.mockResolvedValue(detail());
    api.markRead.mockResolvedValue(undefined);
    api.reply.mockResolvedValue(detail().messages[0]);
    api.raiseUrgent.mockResolvedValue({
      id: 'urgent-1',
      status: 'pending',
      triageNote: 'صعوبة تنفس',
      decisionNote: null,
      createdAt: '2026-09-10T10:00:00.000Z',
      resolvedAt: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mountMessages() {
    const scope = effectScope();
    const state = scope.run(() => useParentMessages());
    if (state === undefined) throw new Error('scope did not run');
    return { state, dispose: () => scope.stop() };
  }

  it('loads the inbox, opens the first thread and marks a staff reply read', async () => {
    api.inbox.mockResolvedValue({
      threads: [summary({ unreadCount: 1 })],
      totalUnread: 1,
    });
    api.detail.mockResolvedValue(detail({ unreadCount: 1 }));
    const { state, dispose } = mountMessages();

    await state.start();

    expect(api.detail).toHaveBeenCalledWith('thread-1');
    expect(api.markRead).toHaveBeenCalledWith('thread-1');
    expect(state.selected.value?.unreadCount).toBe(0);
    expect(state.polling.active.value).toBe(true);
    dispose();
  });

  it('shows a clinic reply on the next poll without blanking the thread', async () => {
    vi.useFakeTimers();
    const { state, dispose } = mountMessages();
    await state.start();
    api.detail.mockResolvedValue(
      detail({
        lastMessagePreview: 'رد الطبيب',
        messages: [
          ...detail().messages,
          {
            id: 'message-2',
            threadId: 'thread-1',
            senderType: 'staff',
            senderName: 'د. شيماء',
            body: 'رد الطبيب',
            createdAt: '2026-09-10T10:01:00.000Z',
          },
        ],
      }),
    );

    const tick = vi.advanceTimersByTimeAsync(PARENT_MESSAGES_POLL_MS);
    expect(state.loading.value).toBe(false);
    expect(state.selected.value?.messages).toHaveLength(1);
    await tick;

    expect(state.selected.value?.messages).toHaveLength(2);
    dispose();
  });

  it('does not let an old inbox response remove a newer conversation', async () => {
    const old = deferred<{ threads: MessageThreadSummary[]; totalUnread: number }>();
    const { state, dispose } = mountMessages();
    await state.start();
    api.inbox.mockReturnValueOnce(old.promise);
    const first = state.refresh();
    api.inbox.mockResolvedValueOnce({
      threads: [summary({ subject: 'الأحدث' })],
      totalUnread: 0,
    });
    await state.refresh();

    old.resolve({ threads: [], totalUnread: 0 });
    await first;

    expect(state.threads.value[0]?.subject).toBe('الأحدث');
    dispose();
  });

  it('reuses the create request id after an uncertain failure', async () => {
    api.inbox.mockResolvedValue({ threads: [], totalUnread: 0 });
    const { state, dispose } = mountMessages();
    await state.start();
    api.create
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(detail());
    const draft = {
      childId: 'child-1',
      subject: 'دواء',
      initialMessage: 'ما الجرعة؟',
    };

    expect(await state.createThread(draft)).toBe(false);
    expect(await state.createThread(draft)).toBe(true);

    expect(api.create.mock.calls[0][0].clientRequestId).toBe(
      api.create.mock.calls[1][0].clientRequestId,
    );
    dispose();
  });

  it('blocks a duplicate reply tap while the first command is in flight', async () => {
    const command = deferred<ReturnType<typeof detail>['messages'][number]>();
    const { state, dispose } = mountMessages();
    await state.start();
    api.reply.mockReturnValueOnce(command.promise);

    const first = state.reply('هل أحضر؟');
    expect(await state.reply('هل أحضر؟')).toBe(false);
    expect(api.reply).toHaveBeenCalledTimes(1);
    command.resolve(detail().messages[0]);
    expect(await first).toBe(true);
    dispose();
  });
});
