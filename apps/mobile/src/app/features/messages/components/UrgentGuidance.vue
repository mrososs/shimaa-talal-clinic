<script setup lang="ts">
import { computed } from 'vue';
import { IonButton, IonTextarea } from '@ionic/vue';
import type { UrgentCaseSummary } from '@clinic/contracts';

const props = defineProps<{
  urgentCase: UrgentCaseSummary | null;
  working: boolean;
}>();

const note = defineModel<string>({ required: true });
const emit = defineEmits<{ raise: [] }>();

const statusLabel = computed(() => {
  if (props.urgentCase?.status === 'accepted') return 'قبلت العيادة الحالة';
  if (props.urgentCase?.status === 'rejected') return 'راجعت العيادة الحالة';
  return 'الحالة قيد مراجعة الطبيب';
});
</script>

<template>
  <section class="urgent">
    <div class="urgent__warning">
      <strong>لو في صعوبة تنفس أو فقدان وعي</strong>
      <p>
        اتصلي بالإسعاف فورًا. الرسائل داخل التطبيق ليست بديلًا عن الطوارئ.
      </p>
    </div>

    <div
      v-if="urgentCase"
      class="urgent__status"
      role="status"
    >
      <strong>{{ statusLabel }}</strong>
      <p>{{ urgentCase.decisionNote ?? urgentCase.triageNote }}</p>
    </div>

    <div
      v-else
      class="urgent__form"
    >
      <ion-textarea
        v-model="note"
        label="ما الذي يجعل الحالة عاجلة؟"
        label-placement="stacked"
        :rows="3"
        :maxlength="5000"
        auto-grow
      />
      <ion-button
        color="danger"
        fill="outline"
        :disabled="working || note.trim().length === 0"
        @click="emit('raise')"
      >
        إرسال كحالة عاجلة
      </ion-button>
    </div>
  </section>
</template>

<style scoped>
.urgent {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.urgent__warning,
.urgent__status {
  padding: 13px;
  border-radius: var(--r-md);
}

.urgent__warning {
  background: #fff0f0;
  color: #9d3030;
  border: 1px solid #ffd4d4;
}

.urgent__status {
  background: var(--teal-soft);
  color: var(--teal-ink);
}

.urgent__warning p,
.urgent__status p {
  margin-block-start: 4px;
  font-size: 12.5px;
  line-height: 1.6;
}

.urgent__form {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
</style>
