<script setup lang="ts">
import type { MessageThreadSummary } from '@clinic/contracts';

defineProps<{
  threads: readonly MessageThreadSummary[];
  selectedId: string | null;
}>();

const emit = defineEmits<{
  select: [threadId: string];
}>();

const dateLabel = (value: string): string =>
  new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
</script>

<template>
  <div
    v-if="threads.length === 0"
    class="empty card"
  >
    <p class="empty__title">
      لا توجد محادثات بعد
    </p>
    <p class="empty__hint">
      ابدئي محادثة جديدة وسيرد فريق العيادة هنا.
    </p>
  </div>

  <div
    v-else
    class="thread-list"
  >
    <button
      v-for="thread in threads"
      :key="thread.id"
      type="button"
      class="thread card"
      :class="{ 'thread--selected': thread.id === selectedId }"
      @click="emit('select', thread.id)"
    >
      <span class="thread__avatar">
        {{ thread.childName.trim().charAt(0) }}
      </span>
      <span class="thread__body">
        <span class="thread__topline">
          <strong>{{ thread.subject }}</strong>
          <small>{{ dateLabel(thread.lastMessageAt) }}</small>
        </span>
        <span class="thread__preview">{{ thread.lastMessagePreview }}</span>
        <span class="thread__meta">
          {{ thread.childName }}
          <span
            v-if="thread.priority === 'urgent'"
            class="urgent-chip"
          >عاجل</span>
          <span
            v-if="thread.status === 'closed'"
            class="closed-chip"
          >مغلقة</span>
        </span>
      </span>
      <span
        v-if="thread.unreadCount > 0"
        class="unread"
        :aria-label="`${thread.unreadCount} رسائل غير مقروءة`"
      >
        {{ thread.unreadCount }}
      </span>
    </button>
  </div>
</template>

<style scoped>
.thread-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.thread {
  width: 100%;
  border: 1.5px solid transparent;
  display: flex;
  align-items: center;
  gap: 11px;
  text-align: start;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.thread--selected {
  border-color: var(--coral);
  box-shadow: var(--sh-sm);
}

.thread__avatar {
  width: 42px;
  height: 42px;
  border-radius: var(--r-pill);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  background: var(--teal-soft);
  color: var(--teal-ink);
  font-family: var(--ff-display);
  font-weight: 800;
}

.thread__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.thread__topline,
.thread__meta {
  display: flex;
  align-items: center;
  gap: 7px;
}

.thread__topline {
  justify-content: space-between;
}

.thread__topline strong,
.thread__preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thread__topline small,
.thread__preview,
.thread__meta {
  color: var(--ink-2);
  font-size: 12px;
}

.urgent-chip,
.closed-chip {
  padding: 2px 7px;
  border-radius: var(--r-pill);
  font-weight: 800;
}

.urgent-chip {
  color: var(--danger);
  background: #fff0f0;
}

.closed-chip {
  background: var(--surface-2);
}

.unread {
  min-width: 24px;
  height: 24px;
  border-radius: var(--r-pill);
  display: grid;
  place-items: center;
  color: #fff;
  background: var(--coral);
  font-size: 12px;
  font-weight: 800;
}

.empty {
  text-align: center;
  padding-block: 26px;
}

.empty__title {
  font-weight: 800;
}

.empty__hint {
  margin-block-start: 5px;
  color: var(--ink-2);
  font-size: 13px;
}
</style>
