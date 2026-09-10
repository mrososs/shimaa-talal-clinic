<script setup lang="ts">
import { computed } from 'vue';
import { IonButton, IonSpinner, IonTextarea } from '@ionic/vue';
import type {
  MessageThreadDetail,
  ThreadMessage,
} from '@clinic/contracts';
import UrgentGuidance from './UrgentGuidance.vue';

type ReadonlyThreadDetail = Omit<MessageThreadDetail, 'messages'> & {
  readonly messages: readonly Readonly<ThreadMessage>[];
};

const props = defineProps<{
  thread: ReadonlyThreadDetail | null;
  loading: boolean;
  working: boolean;
}>();

const replyDraft = defineModel<string>('replyDraft', { required: true });
const urgentNote = defineModel<string>('urgentNote', { required: true });
const emit = defineEmits<{
  reply: [];
  raiseUrgent: [];
}>();

const canReply = computed(
  () =>
    props.thread?.status === 'open' && replyDraft.value.trim().length > 0,
);

const timeLabel = (value: string): string =>
  new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
</script>

<template>
  <section class="conversation card">
    <div
      v-if="loading"
      class="conversation__loading"
    >
      <ion-spinner name="crescent" />
    </div>

    <div
      v-else-if="thread === null"
      class="conversation__empty"
    >
      اختاري محادثة لعرض الرسائل.
    </div>

    <template v-else>
      <header class="conversation__header">
        <div>
          <h2>{{ thread.subject }}</h2>
          <p>{{ thread.childName }}</p>
        </div>
        <span
          class="state"
          :class="{ 'state--closed': thread.status === 'closed' }"
        >
          {{ thread.status === 'closed' ? 'مغلقة' : 'مفتوحة' }}
        </span>
      </header>

      <div
        class="messages"
        aria-live="polite"
      >
        <article
          v-for="message in thread.messages"
          :key="message.id"
          class="bubble"
          :class="{
            'bubble--mine': message.senderType === 'guardian',
            'bubble--clinic': message.senderType === 'staff',
          }"
        >
          <strong>{{ message.senderName }}</strong>
          <p>{{ message.body }}</p>
          <time :datetime="message.createdAt">
            {{ timeLabel(message.createdAt) }}
          </time>
        </article>
      </div>

      <form
        v-if="thread.status === 'open'"
        class="reply"
        @submit.prevent="emit('reply')"
      >
        <ion-textarea
          v-model="replyDraft"
          label="اكتبي ردك"
          label-placement="stacked"
          :rows="3"
          :maxlength="5000"
          auto-grow
        />
        <ion-button
          type="submit"
          :disabled="!canReply || working"
        >
          إرسال الرد
        </ion-button>
      </form>

      <p
        v-else
        class="conversation__closed"
      >
        أغلقت العيادة هذه المحادثة. ابدئي محادثة جديدة إذا كان لديك سؤال آخر.
      </p>

      <urgent-guidance
        v-model="urgentNote"
        :urgent-case="thread.urgentCase"
        :working="working"
        @raise="emit('raiseUrgent')"
      />
    </template>
  </section>
</template>

<style scoped>
.conversation {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.conversation__loading,
.conversation__empty {
  min-height: 120px;
  display: grid;
  place-items: center;
  color: var(--ink-2);
}

.conversation__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.conversation__header h2 {
  font-size: 19px;
}

.conversation__header p {
  color: var(--ink-2);
  font-size: 13px;
}

.state {
  border-radius: var(--r-pill);
  padding: 5px 10px;
  background: var(--teal-soft);
  color: var(--teal-ink);
  font-size: 12px;
  font-weight: 800;
}

.state--closed {
  background: var(--surface-2);
  color: var(--ink-2);
}

.messages {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bubble {
  width: min(88%, 390px);
  border-radius: 16px;
  padding: 11px 13px;
}

.bubble--mine {
  align-self: flex-start;
  background: var(--coral-soft);
  color: var(--coral-ink);
  border-bottom-right-radius: 5px;
}

.bubble--clinic {
  align-self: flex-end;
  background: var(--teal-soft);
  color: var(--teal-ink);
  border-bottom-left-radius: 5px;
}

.bubble strong,
.bubble time {
  font-size: 11px;
}

.bubble p {
  margin-block: 3px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.65;
}

.bubble time {
  opacity: 0.72;
}

.reply {
  display: grid;
  gap: 7px;
}

.conversation__closed {
  padding: 12px;
  border-radius: var(--r-md);
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.6;
}
</style>
