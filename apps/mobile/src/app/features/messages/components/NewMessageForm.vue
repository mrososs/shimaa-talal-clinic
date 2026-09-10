<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { IonButton, IonInput, IonTextarea } from '@ionic/vue';
import type { GuardianChild } from '@clinic/contracts';

const props = defineProps<{
  children: readonly GuardianChild[];
  working: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  submit: [draft: { childId: string; subject: string; initialMessage: string }];
}>();

const childId = shallowRef(props.children[0]?.id ?? '');
const subject = shallowRef('');
const initialMessage = shallowRef('');
const valid = computed(
  () =>
    childId.value !== '' &&
    subject.value.trim().length > 0 &&
    initialMessage.value.trim().length > 0,
);

function submit(): void {
  if (!valid.value || props.working) return;
  emit('submit', {
    childId: childId.value,
    subject: subject.value.trim(),
    initialMessage: initialMessage.value.trim(),
  });
}
</script>

<template>
  <form
    class="new-message card"
    @submit.prevent="submit"
  >
    <div>
      <h2 class="new-message__title">
        محادثة جديدة
      </h2>
      <p class="new-message__hint">
        اكتبي سؤالك بوضوح، وسيظهر الرد هنا داخل التطبيق.
      </p>
    </div>

    <label class="field-label" for="message-child">الطفل</label>
    <select
      id="message-child"
      v-model="childId"
      class="select"
      required
    >
      <option
        v-for="child in children"
        :key="child.id"
        :value="child.id"
      >
        {{ child.fullName }}
      </option>
    </select>

    <ion-input
      v-model="subject"
      label="عنوان الرسالة"
      label-placement="stacked"
      :maxlength="300"
      placeholder="مثال: استفسار عن الدواء"
    />
    <ion-textarea
      v-model="initialMessage"
      label="تفاصيل السؤال"
      label-placement="stacked"
      :rows="5"
      :maxlength="5000"
      auto-grow
    />

    <div class="new-message__actions">
      <ion-button
        type="submit"
        :disabled="!valid || working"
      >
        إرسال الرسالة
      </ion-button>
      <ion-button
        type="button"
        fill="clear"
        :disabled="working"
        @click="emit('cancel')"
      >
        إلغاء
      </ion-button>
    </div>
  </form>
</template>

<style scoped>
.new-message {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.new-message__title {
  font-size: 19px;
}

.new-message__hint {
  margin-block-start: 4px;
  color: var(--ink-2);
  font-size: 13px;
}

.field-label {
  font-size: 13px;
  font-weight: 800;
}

.select {
  width: 100%;
  min-height: 48px;
  border: 1.5px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
  padding-inline: 14px;
  color: var(--ink);
  font: inherit;
}

.new-message__actions {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
}
</style>
