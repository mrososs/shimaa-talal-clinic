import { readonly, shallowRef } from 'vue';
import type {
  MessageThreadDetail,
  MessageThreadSummary,
} from '@clinic/contracts';
import { createSequence, usePolling } from '@clinic/client-ui';
import { messagesApi } from '../../../runtime';
import { apiMessage } from '../../../shared/messages';

export const PARENT_MESSAGES_POLL_MS = 15_000;

interface NewThreadDraft {
  childId: string;
  subject: string;
  initialMessage: string;
}

interface PendingRequest {
  key: string;
  id: string;
}

/** Guardian-owned inbox with safe background refresh and retry idempotency. */
export function useParentMessages() {
  const threads = shallowRef<MessageThreadSummary[]>([]);
  const selected = shallowRef<MessageThreadDetail | null>(null);
  const loading = shallowRef(true);
  const loadingThread = shallowRef(false);
  const working = shallowRef(false);
  const failure = shallowRef<string | null>(null);

  const inboxSequence = createSequence();
  const detailSequence = createSequence();
  let pendingCreate: PendingRequest | null = null;
  const pendingReplies = new Map<string, PendingRequest>();

  async function readInbox(): Promise<void> {
    const ticket = inboxSequence.next();
    const inbox = await messagesApi.inbox();
    if (!inboxSequence.accept(ticket)) return;
    threads.value = inbox.threads;
  }

  async function readThread(threadId: string): Promise<void> {
    const ticket = detailSequence.next();
    const detail = await messagesApi.detail(threadId);
    if (!detailSequence.accept(ticket)) return;
    selected.value = detail;

    if (detail.unreadCount === 0) return;
    await messagesApi.markRead(threadId);
    if (selected.value?.id !== threadId) return;
    selected.value = { ...detail, unreadCount: 0 };
    threads.value = threads.value.map((thread) =>
      thread.id === threadId ? { ...thread, unreadCount: 0 } : thread,
    );
  }

  async function readAll(): Promise<void> {
    const threadId = selected.value?.id;
    await Promise.all([
      readInbox(),
      threadId === undefined ? Promise.resolve() : readThread(threadId),
    ]);
    if (
      selected.value !== null &&
      !threads.value.some((thread) => thread.id === selected.value?.id)
    ) {
      selected.value = null;
    }
  }

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
      failure.value = null;
    } catch (error) {
      failure.value = apiMessage(error);
    }
  }

  const polling = usePolling(poll, {
    intervalMs: PARENT_MESSAGES_POLL_MS,
    onResume: () => void refresh(),
  });

  async function start(): Promise<void> {
    loading.value = threads.value.length === 0;
    failure.value = null;
    try {
      await readInbox();
      const current = selected.value?.id ?? threads.value[0]?.id;
      if (current !== undefined) await readThread(current);
    } catch (error) {
      failure.value = apiMessage(error);
    } finally {
      loading.value = false;
    }
    polling.start();
  }

  function stop(): void {
    polling.stop();
  }

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

  async function run(action: () => Promise<void>): Promise<boolean> {
    if (working.value) return false;
    working.value = true;
    failure.value = null;
    try {
      await action();
      try {
        await readAll();
      } catch (error) {
        failure.value = apiMessage(error);
      }
      return true;
    } catch (error) {
      failure.value = apiMessage(error);
      await readAll().catch(() => undefined);
      return false;
    } finally {
      working.value = false;
    }
  }

  async function createThread(draft: NewThreadDraft): Promise<boolean> {
    const key = JSON.stringify(draft);
    if (pendingCreate?.key !== key) {
      pendingCreate = { key, id: crypto.randomUUID() };
    }
    const request = pendingCreate;
    const succeeded = await run(async () => {
      const created = await messagesApi.create({
        ...draft,
        clientRequestId: request.id,
      });
      selected.value = created;
    });
    if (succeeded) pendingCreate = null;
    return succeeded;
  }

  async function reply(body: string): Promise<boolean> {
    const threadId = selected.value?.id;
    if (threadId === undefined) return false;
    const key = body.trim();
    const previous = pendingReplies.get(threadId);
    const request =
      previous?.key === key
        ? previous
        : { key, id: crypto.randomUUID() };
    pendingReplies.set(threadId, request);

    const succeeded = await run(async () => {
      await messagesApi.reply(threadId, key, request.id);
    });
    if (succeeded) pendingReplies.delete(threadId);
    return succeeded;
  }

  async function raiseUrgent(note: string): Promise<boolean> {
    const threadId = selected.value?.id;
    if (threadId === undefined) return false;
    return run(async () => {
      await messagesApi.raiseUrgent(threadId, note.trim());
    });
  }

  return {
    threads: readonly(threads),
    selected: readonly(selected),
    loading: readonly(loading),
    loadingThread: readonly(loadingThread),
    working: readonly(working),
    failure: readonly(failure),
    polling,
    start,
    stop,
    open,
    refresh,
    createThread,
    reply,
    raiseUrgent,
  };
}

export type ParentMessagesState = ReturnType<typeof useParentMessages>;
