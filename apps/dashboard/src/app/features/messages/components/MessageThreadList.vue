<script setup lang="ts">
import type { MessageThreadSummary } from '@clinic/contracts';

defineProps<{ threads: readonly MessageThreadSummary[]; selectedId: string | null; loading: boolean }>();
const emit = defineEmits<{ select: [threadId: string] }>();

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat('ar-EG', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
</script>

<template>
  <section
    class="dcard thread-list"
    aria-label="المحادثات"
  >
    <div
      v-if="loading"
      class="thread-list__empty"
    >
      جارٍ تحميل الرسائل…
    </div>
    <div
      v-else-if="threads.length === 0"
      class="thread-list__empty"
    >
      لا توجد محادثات تطابق هذا الفلتر.
    </div>
    <button
      v-for="thread in threads"
      v-else
      :key="thread.id"
      type="button"
      class="thread-row"
      :class="{ 'thread-row--selected': selectedId === thread.id }"
      @click="emit('select', thread.id)"
    >
      <span class="thread-row__top">
        <strong>{{ thread.contactName }}</strong>
        <time>{{ timeLabel(thread.lastMessageAt) }}</time>
      </span>
      <span class="thread-row__patient">عن الطفل: {{ thread.childName }}</span>
      <span class="thread-row__subject">{{ thread.subject }}</span>
      <span class="thread-row__preview">{{ thread.lastMessagePreview }}</span>
      <span class="thread-row__meta">
        <span
          v-if="thread.priority === 'urgent'"
          class="dpill dpill--danger"
        >عاجل</span>
        <span
          v-if="thread.assignedMemberName"
          class="dpill"
        >{{ thread.assignedMemberName }}</span>
        <span
          v-if="thread.unreadCount"
          class="thread-row__unread"
        >{{ thread.unreadCount }}</span>
      </span>
    </button>
  </section>
</template>

<style scoped>
.thread-list { min-height: 540px; overflow: hidden; }
.thread-list__empty { padding: 32px 20px; color: var(--muted); text-align: center; }
.thread-row { width: 100%; display: grid; gap: 5px; padding: 15px 17px; border: 0; border-block-end: 1px solid var(--line); background: var(--surface); color: var(--ink); font: inherit; text-align: start; cursor: pointer; }
.thread-row:hover, .thread-row--selected { background: var(--coral-soft); }
.thread-row__top, .thread-row__meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.thread-row__top time, .thread-row__patient, .thread-row__preview { color: var(--muted); font-size: 12px; }
.thread-row__subject { font-weight: 800; font-size: 13px; }
.thread-row__preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.thread-row__meta { justify-content: flex-start; margin-top: 3px; }
.thread-row__unread { margin-inline-start: auto; display: grid; place-items: center; min-width: 23px; height: 23px; border-radius: 50%; background: var(--coral); color: white; font-size: 12px; font-weight: 800; }
</style>
