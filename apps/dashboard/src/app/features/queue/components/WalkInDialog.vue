<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { ClinicDialog } from '@clinic/client-ui';
import type { Guardian, GuardianChild } from '@clinic/contracts';
import { clinicApi } from '../../../runtime';
import { apiMessage } from '../../../shared/messages';
import type { WalkInInput } from '../queue.api';

const props = defineProps<{ open: boolean; working: boolean }>();
const emit = defineEmits<{
  close: [];
  submit: [input: WalkInInput];
}>();

const search = shallowRef('');
const results = shallowRef<Guardian[]>([]);
const guardian = shallowRef<Guardian | null>(null);
const children = shallowRef<GuardianChild[]>([]);
const childId = shallowRef<string | null>(null);
const visitReason = shallowRef('');
const searching = shallowRef(false);
const failure = shallowRef<string | null>(null);

const busy = computed(() => props.working || searching.value);
const canSubmit = computed(
  () => guardian.value !== null && childId.value !== null && !busy.value,
);

watch(
  () => props.open,
  (open) => {
    if (!open) reset();
  },
);

async function runSearch(): Promise<void> {
  const term = search.value.trim();
  if (term.length < 2) {
    failure.value = 'اكتبي حرفين على الأقل أو رقم الهاتف.';
    return;
  }
  searching.value = true;
  failure.value = null;
  try {
    const numeric = /^[\d\s+-]+$/.test(term);
    const page = await clinicApi.searchGuardians(
      numeric ? { phone: term } : { q: term },
    );
    results.value = page.items;
  } catch (error) {
    failure.value = apiMessage(error);
  } finally {
    searching.value = false;
  }
}

async function choose(found: Guardian): Promise<void> {
  searching.value = true;
  failure.value = null;
  try {
    const detail = await clinicApi.guardian(found.id);
    guardian.value = detail.guardian;
    children.value = detail.children;
    childId.value = detail.children[0]?.id ?? null;
    results.value = [];
  } catch (error) {
    failure.value = apiMessage(error);
  } finally {
    searching.value = false;
  }
}

function submit(): void {
  if (!canSubmit.value || guardian.value === null || childId.value === null) {
    return;
  }
  emit('submit', {
    childId: childId.value,
    guardianId: guardian.value.id,
    ...(visitReason.value.trim()
      ? { visitReason: visitReason.value.trim() }
      : {}),
  });
}

function reset(): void {
  search.value = '';
  results.value = [];
  guardian.value = null;
  children.value = [];
  childId.value = null;
  visitReason.value = '';
  failure.value = null;
}
</script>

<template>
  <ClinicDialog
    :open="open"
    title="تسجيل مريض بدون موعد"
    :subject="guardian?.fullName"
    @close="emit('close')"
  >
    <form
      class="walk-in"
      @submit.prevent="runSearch"
    >
      <label class="dfield">
        <span class="dfield__label">ابحثي عن ولي الأمر</span>
        <span class="walk-in__search">
          <input
            v-model="search"
            class="dinput"
            type="search"
            placeholder="الاسم أو رقم الهاتف"
            :disabled="busy"
          >
          <button
            class="dbtn dbtn--ghost"
            type="submit"
            :disabled="busy"
          >
            بحث
          </button>
        </span>
      </label>

      <p
        v-if="failure"
        class="dnotice dnotice--error"
        role="alert"
      >
        {{ failure }}
      </p>

      <div
        v-if="results.length"
        class="walk-in__results"
      >
        <button
          v-for="result in results"
          :key="result.id"
          class="walk-in__result"
          type="button"
          @click="choose(result)"
        >
          <strong>{{ result.fullName }}</strong>
          <span>{{ result.phoneE164 }}</span>
        </button>
      </div>

      <template v-if="guardian">
        <div class="walk-in__chosen">
          <span class="dpill dpill--ok">تم اختيار العائلة</span>
          <strong>{{ guardian.fullName }}</strong>
        </div>

        <fieldset class="walk-in__children">
          <legend class="dfield__label">
            اختاري الطفل
          </legend>
          <label
            v-for="child in children"
            :key="child.id"
            class="walk-in__child"
          >
            <input
              v-model="childId"
              type="radio"
              :value="child.id"
            >
            <span>{{ child.fullName }}</span>
          </label>
          <p
            v-if="children.length === 0"
            class="dmuted"
          >
            لا يوجد أطفال مرتبطون بهذا الحساب. أضيفي الطفل من شاشة الحجز أولاً.
          </p>
        </fieldset>

        <label class="dfield">
          <span class="dfield__label">سبب الزيارة — اختياري</span>
          <textarea
            v-model="visitReason"
            class="dinput walk-in__reason"
            maxlength="280"
            placeholder="وصف مختصر يساعد فريق العيادة"
          />
        </label>
      </template>
    </form>

    <template #actions>
      <button
        class="dbtn dbtn--ghost"
        type="button"
        :disabled="busy"
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
        {{ working ? 'جارٍ التسجيل…' : 'إضافة إلى الطابور' }}
      </button>
    </template>
  </ClinicDialog>
</template>

<style scoped>
.walk-in { display: grid; gap: 16px; }
.walk-in__search { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.walk-in__results { display: grid; gap: 7px; max-height: 210px; overflow-y: auto; }
.walk-in__result { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 13px; border: 1px solid var(--line); border-radius: 12px; color: var(--ink); background: var(--surface-2); font-family: var(--ff-body); cursor: pointer; }
.walk-in__result span { color: var(--muted); direction: ltr; }
.walk-in__chosen { display: flex; align-items: center; gap: 10px; }
.walk-in__children { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; border: 0; }
.walk-in__children legend { width: 100%; }
.walk-in__child { display: flex; align-items: center; gap: 7px; padding: 8px 11px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); font-weight: 700; cursor: pointer; }
.walk-in__reason { min-height: 88px; resize: vertical; }
</style>
