<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ClinicalNoteField from '../components/ClinicalNoteField.vue';
import { useClinicalEncounter } from '../composables/useClinicalEncounter';

const route = useRoute();
const router = useRouter();
const appointmentId = computed(() => String(route.params.appointmentId));
const childName = computed(() => String(route.query.childName ?? 'المريض'));
const state = useClinicalEncounter();
const confirming = shallowRef(false);
const finalized = computed(
  () => state.record.value?.encounter?.status === 'final',
);
const previousEncounters = computed(
  () => state.record.value?.previousEncounters ?? [],
);
const followUpDate = computed(() => {
  const days = state.form.followUpDays;
  if (days === null || days === undefined || days < 1) return null;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'long' }).format(date);
});

function encounterDate(value: string | null): string {
  if (value === null) return '—';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(
    new Date(value),
  );
}

onMounted(() => void state.load(appointmentId.value));

async function finalize(): Promise<void> {
  if (!confirming.value) {
    confirming.value = true;
    return;
  }
  if (await state.finalize(appointmentId.value)) confirming.value = false;
}
</script>

<template>
  <div class="dstack consultation">
    <header class="consultation__head">
      <div>
        <span class="dmuted">جلسة الكشف</span>
        <h1>{{ childName }}</h1>
      </div>
      <div class="drow">
        <button
          class="dbtn dbtn--ghost"
          type="button"
          @click="router.push({ name: 'queue' })"
        >
          العودة للطابور
        </button>
        <button
          class="dbtn dbtn--ghost"
          type="button"
          :disabled="state.working.value || finalized"
          @click="state.save(appointmentId)"
        >
          حفظ كمسودة
        </button>
        <button
          class="dbtn dbtn--teal"
          type="button"
          :disabled="state.working.value || finalized"
          @click="finalize"
        >
          {{
            confirming
              ? 'تأكيد إنهاء الزيارة'
              : finalized
                ? 'تم إنهاء الزيارة'
                : 'إنهاء الزيارة'
          }}
        </button>
      </div>
    </header>

    <p
      v-if="confirming"
      class="dnotice dnotice--warn"
      role="alert"
    >
      هذا الإجراء سيحفظ السجل نهائيًا وينهي المريض في الطابور والموعد معًا.
      اضغطي التأكيد مرة أخرى.
    </p>
    <p
      v-if="state.failure.value"
      class="dnotice dnotice--error"
      role="alert"
    >
      {{ state.failure.value }}
    </p>
    <p
      v-if="state.loading.value"
      class="dcard dcard--pad dmuted"
    >
      جارٍ تحميل جلسة الكشف…
    </p>

    <template v-else>
      <section class="dcard dcard--pad">
        <h2 class="dcard__title">
          القياسات المسجلة عند الاستقبال
        </h2>
        <div class="measurements">
          <template v-if="state.record.value?.measurements[0]">
            <div>
              <strong>{{
                state.record.value.measurements[0].weightKg ?? '—'
              }}</strong><span>الوزن · كجم</span>
            </div>
            <div>
              <strong>{{
                state.record.value.measurements[0].heightCm ?? '—'
              }}</strong><span>الطول · سم</span>
            </div>
            <div>
              <strong>{{
                state.record.value.measurements[0].temperatureC ?? '—'
              }}</strong><span>الحرارة · °م</span>
            </div>
            <div>
              <strong>{{
                state.record.value.measurements[0].headCircumferenceCm ?? '—'
              }}</strong><span>محيط الرأس · سم</span>
            </div>
          </template>
          <p
            v-else
            class="dmuted"
          >
            لم تُسجل قياسات لهذه الزيارة.
          </p>
        </div>
      </section>

      <ClinicalNoteField
        v-model="state.form.diagnosis"
        title="التشخيص والملاحظات السريرية"
        placeholder="اكتب التشخيص وملاحظات الفحص…"
        :disabled="finalized"
      />
      <div class="consultation__columns">
        <ClinicalNoteField
          v-model="state.form.investigations"
          title="تحاليل وإحالات"
          placeholder="أضف تحليلاً أو إحالة…"
          :disabled="finalized"
        />
        <ClinicalNoteField
          v-model="state.form.treatmentInstructions"
          title="تعليمات العلاج"
          placeholder="خطة العلاج والجرعات…"
          :disabled="finalized"
        />
      </div>
      <div class="consultation__columns">
        <ClinicalNoteField
          v-model="state.form.growthObservation"
          title="ملاحظة النمو"
          placeholder="ملاحظات النمو للطبيبة…"
          :disabled="finalized"
        />
        <ClinicalNoteField
          v-model="state.form.parentSummary"
          title="ملخص مبسط للأهل"
          placeholder="التشخيص والعلاج والمتابعة بلغة مبسطة…"
          :disabled="finalized"
        />
      </div>
      <section class="dcard dcard--pad follow-up">
        <label class="dfield">
          <span class="dfield__label">المتابعة بعد عدد أيام</span>
          <input
            v-model.number="state.form.followUpDays"
            class="dinput"
            type="number"
            min="1"
            max="365"
            :disabled="finalized"
          >
        </label>
        <p
          v-if="followUpDate"
          class="follow-up__date"
        >
          موعد المتابعة المقترح: <strong>{{ followUpDate }}</strong>
        </p>
      </section>

      <section class="dcard dcard--pad parent-preview">
        <span class="dmuted">معاينة ما سيظهر في ملخص الأهل</span>
        <h2 class="dcard__title">
          ملخص الزيارة
        </h2>
        <p v-if="state.form.parentSummary.trim()">
          {{ state.form.parentSummary }}
        </p>
        <p
          v-else
          class="dmuted"
        >
          اكتبي ملخصًا مبسطًا للتشخيص والعلاج وخطة المتابعة.
        </p>
      </section>

      <section class="dcard">
        <header class="dcard__head">
          <h2 class="dcard__title">
            الزيارات السابقة
          </h2>
          <span class="dpill">{{ previousEncounters.length }}</span>
        </header>
        <p
          v-if="previousEncounters.length === 0"
          class="dcard--pad dmuted"
        >
          لا توجد زيارات سريرية مكتملة سابقة.
        </p>
        <div
          v-else
          class="previous-visits"
        >
          <article
            v-for="encounter in previousEncounters"
            :key="encounter.id"
          >
            <time :datetime="encounter.finalizedAt ?? undefined">
              {{ encounterDate(encounter.finalizedAt) }}
            </time>
            <strong>{{ encounter.diagnosis || 'بدون تشخيص مسجل' }}</strong>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.consultation__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.consultation__head h1 {
  margin: 2px 0 0;
  font-family: var(--ff-display);
}
.consultation__columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
.measurements {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-top: 14px;
}
.measurements div {
  display: grid;
  gap: 3px;
  padding: 12px;
  border-radius: 14px;
  background: var(--surface-2);
  text-align: center;
}
.measurements strong {
  color: var(--teal-ink);
  font: 800 24px var(--ff-display);
}
.measurements span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}
.follow-up {
  max-width: 420px;
}
.follow-up__date {
  margin: 12px 0 0;
  color: var(--teal-ink);
}
.parent-preview {
  display: grid;
  gap: 8px;
}
.parent-preview h2,
.parent-preview p {
  margin: 0;
}
.parent-preview p {
  line-height: 1.8;
  white-space: pre-wrap;
}
.previous-visits {
  display: grid;
}
.previous-visits article {
  display: grid;
  grid-template-columns: minmax(130px, auto) 1fr;
  gap: 16px;
  padding: 13px 18px;
  border-top: 1px solid var(--line);
}
.previous-visits time {
  color: var(--muted);
}
@media (max-width: 850px) {
  .consultation__head {
    align-items: stretch;
    flex-direction: column;
  }
  .consultation__columns {
    grid-template-columns: 1fr;
  }
  .measurements {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
