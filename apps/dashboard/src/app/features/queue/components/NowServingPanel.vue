<script setup lang="ts">
import { computed } from 'vue';
import type { QueueBoardEntry } from '@clinic/contracts';
import { arabicDigits } from '../../../shared/numerals';
import { ageLabel } from '../../../shared/format';

/**
 * Who is in the room, and who has just been called.
 *
 * The one panel a doctor looks at between patients, so it holds exactly what
 * she needs to start: the name, the age, why they came, and explicit buttons
 * that never hide the fact that a consultation is being ended.
 */

const props = defineProps<{
  inService: QueueBoardEntry | null;
  called: QueueBoardEntry | null;
  waitingCount: number;
  running: boolean;
  working: string | null;
  /** Reception may skip a patient; the doctor calls, starts and completes. */
  canMiss: boolean;
  /** Only roles authorised by the API to end a consultation. */
  canComplete: boolean;
  /** Clinical notes are doctor/admin only even though reception can complete. */
  canOpenClinical?: boolean;
  /** Vitals are a clinical reading: doctor/admin only. */
  canRecordMeasurements?: boolean;
  /** Summoning the next patient is the desk's decision, not the doctor's. */
  canCallNext?: boolean;
}>();

const emit = defineEmits<{
  callNext: [];
  start: [entryId: string];
  complete: [entryId: string];
  completeAndCallNext: [];
  miss: [entry: QueueBoardEntry];
  recordMeasurements: [entry: QueueBoardEntry];
}>();

const busy = computed(() => props.working !== null);

/** Whether the promised grace has run out, recomputed from the timestamp. */
const graceLapsed = computed(() => {
  const at = props.called?.graceExpiresAt;
  return at !== null && at !== undefined && Date.parse(at) <= Date.now();
});
</script>

<template>
  <section class="dcard dcard--pad now">
    <header class="now__head">
      <h2 class="dcard__title">الآن</h2>
      <button
        v-if="!inService && canCallNext"
        class="dbtn dbtn--primary"
        :disabled="
          busy ||
          !running ||
          waitingCount === 0 ||
          (called !== null && !graceLapsed)
        "
        @click="emit('callNext')"
      >
        استدعاء التالي
      </button>
    </header>

    <!-- In the room. -->
    <div
      v-if="inService"
      class="now__patient now__patient--serving"
      :data-entry-id="inService.id"
      :data-appointment-id="inService.appointmentId ?? undefined"
    >
      <span class="now__ticket">{{
        arabicDigits(inService.ticketNumber)
      }}</span>
      <div class="now__who">
        <strong>{{ inService.child.fullName }}</strong>
        <span class="dmuted">
          {{ ageLabel(inService.child.dateOfBirth) ?? '—' }}
          <template v-if="inService.visitReason">
            · {{ inService.visitReason }}
          </template>
        </span>
      </div>
      <span class="dpill dpill--ok">في الكشف</span>
      <div v-if="canComplete" class="now__actions">
        <button
          v-if="canRecordMeasurements"
          class="dbtn dbtn--ghost dbtn--sm"
          type="button"
          :disabled="busy"
          @click="emit('recordMeasurements', inService)"
        >
          تسجيل القياسات
        </button>
        <RouterLink
          v-if="canOpenClinical && inService.appointmentId"
          class="dbtn dbtn--ghost dbtn--sm"
          :to="{
            name: 'consultation',
            params: { appointmentId: inService.appointmentId },
            query: { childName: inService.child.fullName },
          }"
        >
          فتح جلسة الكشف
        </RouterLink>
        <button
          class="dbtn dbtn--teal dbtn--sm"
          :disabled="busy || !running"
          @click="emit('complete', inService.id)"
        >
          إنهاء الكشف
        </button>
        <button
          v-if="canCallNext"
          class="dbtn dbtn--primary dbtn--sm"
          :disabled="busy || !running || waitingCount === 0"
          @click="emit('completeAndCallNext')"
        >
          إنهاء واستدعاء التالي
        </button>
      </div>
    </div>

    <!-- Called, and we are waiting for them to walk in. -->
    <div
      v-if="called"
      class="now__patient"
      :data-entry-id="called.id"
      :data-appointment-id="called.appointmentId ?? undefined"
    >
      <span class="now__ticket">{{ arabicDigits(called.ticketNumber) }}</span>
      <div class="now__who">
        <strong>{{ called.child.fullName }}</strong>
        <span class="dmuted">
          {{ ageLabel(called.child.dateOfBirth) ?? '—' }}
          <template v-if="called.guardian">
            · {{ called.guardian.fullName }}</template
          >
        </span>
      </div>
      <span
        class="dpill"
        :class="graceLapsed ? 'dpill--danger' : 'dpill--warn'"
      >
        {{ graceLapsed ? 'انتهت المهلة' : 'تم النداء' }}
      </span>
      <div class="now__actions">
        <button
          v-if="canRecordMeasurements"
          class="dbtn dbtn--ghost dbtn--sm"
          type="button"
          :disabled="busy"
          @click="emit('recordMeasurements', called)"
        >
          تسجيل القياسات
        </button>
        <button
          class="dbtn dbtn--teal dbtn--sm"
          :disabled="busy"
          @click="emit('start', called.id)"
        >
          بدء الكشف
        </button>
        <button
          v-if="canMiss"
          class="dbtn dbtn--ghost dbtn--sm"
          :disabled="busy"
          @click="emit('miss', called)"
        >
          لم يحضر
        </button>
      </div>
    </div>

    <p v-if="!inService && !called" class="dmuted now__empty">
      <template v-if="!running"> الطابور غير مفعّل الآن. </template>
      <template v-else-if="waitingCount === 0">
        لا يوجد مرضى في الانتظار.
      </template>
      <template v-else>
        لم يبدأ النداء بعد — {{ arabicDigits(waitingCount) }} في الانتظار.
      </template>
    </p>
  </section>
</template>

<style scoped>
.now {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.now__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.now__patient {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-radius: var(--r-md);
  background: var(--surface-2);
  border: 1.5px solid var(--line);
  flex-wrap: wrap;
}

.now__patient--serving {
  background: var(--teal-soft);
  border-color: transparent;
}

.now__ticket {
  font-family: var(--ff-display);
  font-size: 26px;
  font-weight: 800;
  min-width: 52px;
  text-align: center;
}

.now__who {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 140px;
}

.now__who span {
  font-size: 13px;
}

.now__actions {
  display: flex;
  gap: 6px;
}

.now__empty {
  margin: 0;
  padding: 18px 0;
  text-align: center;
}
</style>
