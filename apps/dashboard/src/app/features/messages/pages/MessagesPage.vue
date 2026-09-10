<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ClinicMemberRole, type ClinicSession } from '@clinic/contracts';
import { queueApi, session } from '../../../runtime';
import MessageConversation from '../components/MessageConversation.vue';
import MessageFilters from '../components/MessageFilters.vue';
import MessageThreadList from '../components/MessageThreadList.vue';
import { useMessagesInbox } from '../composables/useMessagesInbox';

const inbox = useMessagesInbox();
const sessions = ref<ClinicSession[]>([]);
const role = computed(() => session.state.identity?.member.role ?? ClinicMemberRole.Reception);

onMounted(async () => {
  const today = session.state.identity?.clinic.today;
  // The day's sessions are only needed to name a target for an accepted urgent
  // case. A failure there must not stop the inbox from opening.
  const [, daySessions] = await Promise.all([
    inbox.start(),
    queueApi.sessions(today).catch(() => []),
  ]);
  sessions.value = daySessions;
});
</script>

<template>
  <div class="dstack">
    <MessageFilters
      :model-value="inbox.filter.value"
      :unread-count="inbox.totalUnread.value"
      @update:model-value="inbox.setFilter"
    />
    <p
      v-if="inbox.failure.value"
      class="dnotice dnotice--error"
      role="alert"
    >
      {{ inbox.failure.value }}
    </p>
    <div class="messages-layout">
      <MessageThreadList
        :threads="inbox.threads.value"
        :selected-id="inbox.selected.value?.id ?? null"
        :loading="inbox.loading.value"
        @select="inbox.open"
      />
      <MessageConversation
        :thread="inbox.selected.value"
        :templates="inbox.templates.value"
        :sessions="sessions"
        :role="role"
        :working="inbox.working.value"
        :loading="inbox.loadingThread.value"
        @reply="inbox.reply"
        @assign="inbox.assignToDoctor"
        @close="inbox.close"
        @reopen="inbox.reopen"
        @urgent="inbox.raiseUrgent"
        @accept-urgent="inbox.acceptUrgent"
        @reject-urgent="inbox.rejectUrgent"
      />
    </div>
  </div>
</template>

<style scoped>
.messages-layout { display: grid; grid-template-columns: minmax(270px, 0.72fr) minmax(480px, 1.7fr); gap: 18px; align-items: start; }
@media (max-width: 1050px) { .messages-layout { grid-template-columns: 1fr; } }
</style>
