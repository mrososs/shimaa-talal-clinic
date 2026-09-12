<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonButton,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  onIonViewDidLeave,
  onIonViewWillEnter,
  type RefresherCustomEvent,
} from '@ionic/vue';
import { addOutline } from 'ionicons/icons';
import ScreenShell from '../../../shared/components/ScreenShell.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { session } from '../../../runtime';
import ConversationPanel from '../components/ConversationPanel.vue';
import MessageThreadList from '../components/MessageThreadList.vue';
import NewMessageForm from '../components/NewMessageForm.vue';
import { useParentMessages } from '../composables/useParentMessages';

const inbox = useParentMessages();
const route = useRoute();
const showNew = shallowRef(false);
const replyDraft = shallowRef('');
const urgentNote = shallowRef('');
const children = computed(() => session.state.identity?.children ?? []);

async function refresh(event?: RefresherCustomEvent): Promise<void> {
  await inbox.refresh();
  await event?.target.complete();
}

async function createThread(draft: {
  childId: string;
  subject: string;
  initialMessage: string;
}): Promise<void> {
  const succeeded = await inbox.createThread(draft);
  if (succeeded) showNew.value = false;
}

async function openThread(threadId: string): Promise<void> {
  replyDraft.value = '';
  urgentNote.value = '';
  await inbox.open(threadId);
}

async function reply(): Promise<void> {
  const body = replyDraft.value.trim();
  if (body.length === 0) return;
  if (await inbox.reply(body)) replyDraft.value = '';
}

async function raiseUrgent(): Promise<void> {
  const note = urgentNote.value.trim();
  if (note.length === 0) return;
  if (await inbox.raiseUrgent(note)) urgentNote.value = '';
}

onIonViewWillEnter(() => {
  void (async () => {
    await inbox.start();
    const threadId = route.query['threadId'];
    if (typeof threadId === 'string') await openThread(threadId);
  })();
});
onIonViewDidLeave(() => inbox.stop());
</script>

<template>
  <screen-shell
    title="رسائل العيادة"
    subtitle="تواصلي مع فريق العيادة بأمان"
  >
    <template #above>
      <ion-refresher
        slot="fixed"
        @ion-refresh="refresh($event)"
      >
        <ion-refresher-content />
      </ion-refresher>
    </template>

    <template #header-end>
      <ion-button
        fill="clear"
        size="small"
        :disabled="children.length === 0"
        @click="showNew = !showNew"
      >
        <ion-icon
          slot="start"
          :icon="addOutline"
        />
        رسالة جديدة
      </ion-button>
    </template>

    <div class="messages-page">
      <form-notice :message="inbox.failure.value" />

      <new-message-form
        v-if="showNew"
        :children="children"
        :working="inbox.working.value"
        @cancel="showNew = false"
        @submit="createThread"
      />

      <div
        v-if="inbox.loading.value"
        class="loading card"
      >
        <ion-spinner name="crescent" />
      </div>

      <template v-else>
        <message-thread-list
          :threads="inbox.threads.value"
          :selected-id="inbox.selected.value?.id ?? null"
          @select="openThread"
        />

        <conversation-panel
          v-model:reply-draft="replyDraft"
          v-model:urgent-note="urgentNote"
          :thread="inbox.selected.value"
          :loading="inbox.loadingThread.value"
          :working="inbox.working.value"
          @reply="reply"
          @raise-urgent="raiseUrgent"
        />
      </template>
    </div>
  </screen-shell>
</template>

<style scoped>
.messages-page {
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.loading {
  min-height: 180px;
  display: grid;
  place-items: center;
}
</style>
