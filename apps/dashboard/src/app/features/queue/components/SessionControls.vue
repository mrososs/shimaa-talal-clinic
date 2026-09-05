<script setup lang="ts">
import { computed } from 'vue';
import {
  ClinicSessionStatus,
  DoctorPresence,
  type ClinicSession,
} from '@clinic/contracts';
import { arabicDigits } from '../../../shared/numerals';
import { timeLabel } from '../../../shared/format';

/**
 * What staff say about the day itself.
 *
 * Three separate decisions, so three separate controls. Pausing keeps
 * everyone's place and stops the queue advancing; closing is final; saying the
 * doctor is late is not an operational change at all — it is the honest input
 * to what every waiting family is shown on their phone.
 */

const props = defineProps<{
  session: ClinicSession | null;
  sessions: readonly ClinicSession[];
  timezone: string;
  working: string | null;
}>();

const emit = defineEmits<{
  select: [sessionId: string];
  open: [];
  pause: [];
  resume: [];
  close: [];
  presence: [presence: DoctorPresence];
  pace: [minutes: number];
}>();

const STATUS: Record<string, { label: string; tone: string }> = {
  scheduled: { label: 'لم تبدأ', tone: '' },
  open: { label: 'الطابور يعمل', tone: 'ok' },
  paused: { label: 'متوقف مؤقتاً', tone: 'warn' },
  closed: { label: 'انتهى اليوم', tone: 'danger' },
};

const PRESENCE: { value: DoctorPresence; label: string }[] = [
  { value: DoctorPresence.Arrived, label: 'وصلت' },
  { value: DoctorPresence.EnRoute, label: 'في الطريق' },
  { value: DoctorPresence.NotArrived, label: 'لم تصل' },
  { value: DoctorPresence.Expected, label: 'متوقّعة' },
];

const KIND: Record<string, string> = {
  morning: 'الفترة الصباحية',
  evening: 'الفترة المسائية',
};

const status = computed(
  () => STATUS[props.session?.status ?? ''] ?? STATUS['scheduled'],
);
const busy = computed(() => props.working !== null);

function stepPace(by: number): void {
  const current = props.session?.avgConsultMinutes ?? 6;
  const next = Math.min(240, Math.max(1, current + by));
  if (next !== current) emit('pace', next);
}
</script>

<template>
  <section class="dcard dcard--pad controls">
    <div class="controls__row">
      <div class="controls__state">
        <span
          class="dpill"
          :class="status.tone ? `dpill--${status.tone}` : ''"
        >{{ status.label }}</span>

        <span
          v-if="session"
          class="dmuted controls__hours"
        >
          {{ KIND[session.sessionKind] ?? session.sessionKind }} ·
          {{ timeLabel(session.plannedStart, timezone) }} –
          {{ timeLabel(session.plannedEnd, timezone) }}
        </span>
      </div>

      <!-- Only shown when the clinic actually runs two half-days. -->
      <div
        v-if="sessions.length > 1"
        class="dtabs"
      >
        <button
          v-for="option in sessions"
          :key="option.id"
          type="button"
          :class="{ on: option.id === session?.id }"
          @click="emit('select', option.id)"
        >
          {{ KIND[option.sessionKind] ?? option.sessionKind }}
        </button>
      </div>
    </div>

    <div class="controls__row">
      <div class="drow">
        <button
          v-if="session?.status === ClinicSessionStatus.Scheduled"
          class="dbtn dbtn--teal dbtn--sm"
          :disabled="busy"
          @click="emit('open')"
        >
          بدء اليوم
        </button>
        <button
          v-if="session?.status === ClinicSessionStatus.Open"
          class="dbtn dbtn--ghost dbtn--sm"
          :disabled="busy"
          @click="emit('pause')"
        >
          إيقاف مؤقت
        </button>
        <button
          v-if="session?.status === ClinicSessionStatus.Paused"
          class="dbtn dbtn--teal dbtn--sm"
          :disabled="busy"
          @click="emit('resume')"
        >
          استئناف
        </button>
        <button
          v-if="session && session.status !== ClinicSessionStatus.Closed"
          class="dbtn dbtn--ghost dbtn--sm"
          :disabled="busy"
          @click="emit('close')"
        >
          إنهاء اليوم
        </button>
      </div>

      <div class="drow controls__pace">
        <span class="dfield__label">مدة الكشف</span>
        <button
          class="diconbtn"
          type="button"
          :disabled="busy"
          aria-label="إنقاص دقيقة"
          @click="stepPace(-1)"
        >
          −
        </button>
        <strong class="controls__minutes">
          {{ arabicDigits(session?.avgConsultMinutes ?? 6) }} د
        </strong>
        <button
          class="diconbtn"
          type="button"
          :disabled="busy"
          aria-label="زيادة دقيقة"
          @click="stepPace(1)"
        >
          +
        </button>
      </div>
    </div>

    <div class="controls__row controls__row--start">
      <span class="dfield__label">الطبيبة</span>
      <div class="dtabs">
        <button
          v-for="option in PRESENCE"
          :key="option.value"
          type="button"
          :disabled="busy"
          :class="{ on: session?.doctorPresence === option.value }"
          @click="emit('presence', option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <span
        v-if="session?.delayMinutes"
        class="dpill dpill--warn"
      >
        تأخير {{ arabicDigits(session.delayMinutes) }} د
      </span>
    </div>
  </section>
</template>

<style scoped>
.controls {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.controls__row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: space-between;
}

.controls__row--start {
  justify-content: flex-start;
}

.controls__state {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.controls__hours {
  font-size: 13px;
  font-weight: 600;
}

.controls__pace {
  gap: 8px;
}

.controls__minutes {
  font-family: var(--ff-display);
  min-width: 52px;
  text-align: center;
}
</style>
