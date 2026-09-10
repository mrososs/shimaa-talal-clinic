import { computed, readonly, ref, shallowRef } from 'vue';
import type {
  MessageInboxFilter,
  MessageThreadDetail,
  MessageThreadSummary,
  QuickReplyTemplate,
} from '@clinic/contracts';
import { createSequence, usePolling } from '@clinic/client-ui';
import { messagesApi } from '../../../runtime';
import { apiMessage } from '../../../shared/messages';

/** Five seconds, the same beat as the queue board. */
export const INBOX_POLL_MS = 5_000;

/**
 * The staff inbox, and every way it changes.
 *
 * An inbox is only useful if it is live. A family's reply arrives while nobody
 * is typing, and the unread count is the whole point of the screen — a number
 * that only moves when somebody reloads is worse than no number, because the
 * desk learns to distrust it. So this follows the same lifecycle as the queue
 * board: one loop, paused while hidden, a full read on return, an immediate
 * re-read after this desk acts, and arrival-ordered answers.
 *
 * Two reads run on that loop, not one — the thread list and the open
 * conversation — because they change independently and a reply lands in both.
 */
export function useMessagesInbox() {
  const filter = ref<MessageInboxFilter>('all');
  const threads = shallowRef<MessageThreadSummary[]>([]);
  const templates = shallowRef<QuickReplyTemplate[]>([]);
  const selected = shallowRef<MessageThreadDetail | null>(null);

  /** The first read only. A tick must never blank a screen being read. */
  const loading = ref(true);
  const loadingThread = ref(false);
  const working = ref(false);
  const failure = ref<string | null>(null);

  const totalUnread = computed(() =>
    threads.value.reduce((total, thread) => total + thread.unreadCount, 0),
  );

  /**
   * Two sequences, because these are two independent reads.
   *
   * One shared guard would let a fast list answer discard a conversation
   * answer that was asked earlier but describes a different thing entirely.
   */
  const listSequence = createSequence();
  const threadSequence = createSequence();

  // --- reading ----------------------------------------------------------

  async function readInbox(): Promise<void> {
    const ticket = listSequence.next();
    const asked = filter.value;
    const inbox = await messagesApi.inbox(asked);
    if (!listSequence.accept(ticket)) return;

    threads.value = inbox.threads;
    templates.value = inbox.templates;
  }

  /**
   * Read one conversation, and mark it read when it is the one on screen.
   *
   * Marking read is a write, and deliberately not something a background tick
   * does to a thread nobody is looking at. It happens here because this is the
   * thread the reader has open — which is exactly what "read" means.
   */
  async function readThread(threadId: string): Promise<void> {
    const ticket = threadSequence.next();
    const detail = await messagesApi.detail(threadId);
    if (!threadSequence.accept(ticket)) return;

    selected.value = detail;
    if (detail.unreadCount === 0) return;

    await messagesApi.markRead(threadId);
    // Another thread may have been opened while that write was in flight.
    if (selected.value?.id !== threadId) return;

    selected.value = { ...detail, unreadCount: 0 };
    threads.value = threads.value.map((thread) =>
      thread.id === threadId ? { ...thread, unreadCount: 0 } : thread,
    );
  }

  /**
   * The list, and the conversation if one is open.
   *
   * The two run together, so whether the open thread still belongs on screen
   * is decided once both have landed. Deciding it inside the list read would
   * race the conversation read, which re-selects the thread it was asked for.
   */
  async function readAll(): Promise<void> {
    const open = selected.value?.id;
    await Promise.all([
      readInbox(),
      open === undefined ? Promise.resolve() : readThread(open),
    ]);

    // A thread that has left the current filter — closed while "المفتوحة" is
    // selected — stops being the conversation on screen, rather than lingering
    // beside a list that no longer contains it.
    const current = selected.value;
    if (
      current !== null &&
      !threads.value.some((thread) => thread.id === current.id)
    ) {
      selected.value = null;
    }
  }

  /** A full read that leaves `loading` alone. Used after a command and on return. */
  async function refresh(): Promise<void> {
    failure.value = null;
    try {
      await readAll();
    } catch (error) {
      failure.value = apiMessage(error);
    }
  }

  async function poll(): Promise<void> {
    try {
      await readAll();
      // A tick that succeeds clears what the last one reported: the connection
      // came back, and leaving the banner up would be a lie.
      failure.value = null;
    } catch (error) {
      failure.value = apiMessage(error);
    }
  }

  const polling = usePolling(poll, {
    intervalMs: INBOX_POLL_MS,
    onResume: () => void refresh(),
  });

  /** Load the inbox, open the first thread, and start watching. */
  async function start(): Promise<void> {
    loading.value = true;
    failure.value = null;
    try {
      await readInbox();
      const first = threads.value[0];
      if (first !== undefined) await readThread(first.id);
    } catch (error) {
      failure.value = apiMessage(error);
    } finally {
      loading.value = false;
    }
    polling.start();
  }

  async function setFilter(next: MessageInboxFilter): Promise<void> {
    filter.value = next;
    await refresh();
  }

  /** Somebody clicked a thread: this one read may show a spinner. */
  async function open(threadId: string): Promise<void> {
    loadingThread.value = true;
    failure.value = null;
    try {
      await readThread(threadId);
    } catch (error) {
      failure.value = apiMessage(error);
    } finally {
      loadingThread.value = false;
    }
  }

  // --- commands ---------------------------------------------------------

  /**
   * Run one command, then re-read.
   *
   * The re-read happens whether or not the command succeeded, for the same
   * reason the queue board does it: a refusal means somebody else moved first,
   * and the only useful answer to that is what is true now.
   */
  async function run(action: () => Promise<unknown>): Promise<void> {
    if (working.value) return;
    working.value = true;
    failure.value = null;
    try {
      await action();
      await readAll();
    } catch (error) {
      failure.value = apiMessage(error);
      await readAll().catch(() => undefined);
    } finally {
      working.value = false;
    }
  }

  function withSelected(
    action: (threadId: string) => Promise<unknown>,
  ): Promise<void> {
    const threadId = selected.value?.id;
    return threadId === undefined ? Promise.resolve() : run(() => action(threadId));
  }

  return {
    filter: readonly(filter),
    threads: readonly(threads),
    templates: readonly(templates),
    selected: readonly(selected),
    totalUnread,
    loading: readonly(loading),
    loadingThread: readonly(loadingThread),
    working: readonly(working),
    failure: readonly(failure),
    polling,
    start,
    setFilter,
    open,
    refresh,
    reply: (body: string) =>
      withSelected((threadId) =>
        messagesApi.reply(threadId, body, crypto.randomUUID()),
      ),
    assignToDoctor: () => withSelected(messagesApi.assignToDoctor),
    close: () => withSelected(messagesApi.close),
    reopen: () => withSelected(messagesApi.reopen),
    raiseUrgent: (note: string) =>
      withSelected((threadId) => messagesApi.raiseUrgent(threadId, note)),
    rejectUrgent: (caseId: string, note?: string) =>
      run(() => messagesApi.rejectUrgent(caseId, note)),
    acceptUrgent: (caseId: string, sessionId: string, note?: string) =>
      run(() => messagesApi.acceptUrgent(caseId, sessionId, note)),
  };
}

export type MessagesInboxState = ReturnType<typeof useMessagesInbox>;
