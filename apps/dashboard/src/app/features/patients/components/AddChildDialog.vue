<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChildSex, GuardianRelationship } from '@clinic/contracts';
import { ClinicDialog } from '@clinic/client-ui';

export interface AddChildInput {
  fullName: string;
  dateOfBirth?: string;
  sex?: ChildSex;
  relationship?: GuardianRelationship;
  isPrimary?: boolean;
}

const props = defineProps<{ open: boolean; familyName?: string; working: boolean }>();
const emit = defineEmits<{ close: []; submit: [input: AddChildInput] }>();

const fullName = ref('');
const dateOfBirth = ref('');
const sex = ref<ChildSex | ''>('');
const relationship = ref<GuardianRelationship>(GuardianRelationship.Other);
const isPrimary = ref(false);
const canSubmit = computed(() => fullName.value.trim().length >= 2 && !props.working);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      fullName.value = '';
      dateOfBirth.value = '';
      sex.value = '';
      relationship.value = GuardianRelationship.Other;
      isPrimary.value = false;
    }
  },
);

function submit(): void {
  if (!canSubmit.value) return;
  emit('submit', {
    fullName: fullName.value.trim(),
    ...(dateOfBirth.value ? { dateOfBirth: dateOfBirth.value } : {}),
    ...(sex.value ? { sex: sex.value } : {}),
    relationship: relationship.value,
    isPrimary: isPrimary.value,
  });
}
</script>

<template>
  <ClinicDialog
    :open="open"
    title="إضافة طفل"
    :subject="familyName"
    @close="emit('close')"
  >
    <form
      class="child-form"
      @submit.prevent="submit"
    >
      <label class="dfield">
        <span class="dfield__label">اسم الطفل</span>
        <input
          v-model="fullName"
          class="dinput"
          autocomplete="off"
          :disabled="working"
        >
      </label>
      <div class="child-form__row">
        <label class="dfield">
          <span class="dfield__label">تاريخ الميلاد — اختياري</span>
          <input
            v-model="dateOfBirth"
            class="dinput"
            type="date"
            :disabled="working"
          >
        </label>
        <label class="dfield">
          <span class="dfield__label">النوع — اختياري</span>
          <select
            v-model="sex"
            class="dinput"
            :disabled="working"
          >
            <option value="">غير محدد</option>
            <option :value="ChildSex.Female">بنت</option>
            <option :value="ChildSex.Male">ولد</option>
          </select>
        </label>
      </div>
      <label class="dfield">
        <span class="dfield__label">صلة ولي الأمر</span>
        <select
          v-model="relationship"
          class="dinput"
          :disabled="working"
        >
          <option :value="GuardianRelationship.Mother">الأم</option>
          <option :value="GuardianRelationship.Father">الأب</option>
          <option :value="GuardianRelationship.Grandparent">الجد/الجدة</option>
          <option :value="GuardianRelationship.Other">أخرى</option>
        </select>
      </label>
      <label class="child-form__check">
        <input
          v-model="isPrimary"
          type="checkbox"
          :disabled="working"
        >
        ولي الأمر الأساسي للطفل
      </label>
    </form>

    <template #actions>
      <button
        class="dbtn dbtn--ghost"
        type="button"
        :disabled="working"
        @click="emit('close')"
      >
        تراجع
      </button>
      <button
        class="dbtn dbtn--teal"
        type="button"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ working ? 'جارٍ الإضافة…' : 'إضافة الطفل' }}
      </button>
    </template>
  </ClinicDialog>
</template>

<style scoped>
.child-form { display: grid; gap: 14px; }
.child-form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.child-form__check { display: flex; align-items: center; gap: 8px; font-weight: 700; }
@media (max-width: 620px) { .child-form__row { grid-template-columns: 1fr; } }
</style>
