<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { ClinicDialog } from '@clinic/client-ui';
import type {
  Appointment,
  AppointmentListItem,
  AvailabilityDay,
  AvailabilityWindow,
} from '@clinic/contracts';
import { clinicApi } from '../../../runtime';
import { apiMessage } from '../../../shared/messages';
import { arabicDigits } from '../../../shared/numerals';

const props = defineProps<{
  open: boolean;
  appointment: AppointmentListItem | null;
  timezone: string;
  today: string;
}>();

const emit = defineEmits<{
  close: [];
  rescheduled: [appointment: Appointment];
}>();

const days = shallowRef<AvailabilityDay[]>([]);
const selected = shallowRef<AvailabilityWindow | null>(null);
const loading = shallowRef(false);
const saving = shallowRef(false);
const failure = shallowRef<string | null>(null);
let requestSequence = 0;

const availableDays = computed(() =>
  days.value
    .map((day) => ({
      ...day,
      windows: day.windows.filter((window) => window.remaining > 0),
    }))
    .filter((day) => day.windows.length > 0),
);

watch(
  () => [props.open, props.appointment?.id] as const,
  ([open]) => {
    if (!open) return;
    selected.value = null;
    void loadAvailability();
  },
  { immediate: true },
);

async function loadAvailability(): Promise<void> {
  const sequence = ++requestSequence;
  loading.value = true;
  failure.value = null;
  try {
    const result = await clinicApi.availability({
      date: props.today,
      to: addDays(props.today, 6),
    });
    if (sequence === requestSequence) days.value = result;
  } catch (error) {
    if (sequence === requestSequence) failure.value = apiMessage(error);
  } finally {
    if (sequence === requestSequence) loading.value = false;
  }
}

async function submit(): Promise<void> {
  if (props.appointment === null || selected.value === null) return;
  saving.value = true;
  failure.value = null;
  try {
    const result = await clinicApi.reschedule(props.appointment.id, {
      sessionId: selected.value.sessionId,
      windowStart: selected.value.windowStart,
    });
    emit('rescheduled', result);
  } catch (error) {
    failure.value = apiMessage(error);
    await loadAvailability();
  } finally {
    saving.value = false;
  }
}

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat('ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: props.timezone,
  }).format(new Date(`${date}T12:00:00Z`));
}

function windowLabel(window: AvailabilityWindow): string {
  const format = new Intl.DateTimeFormat('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: props.timezone,
  });
  return `${format.format(new Date(window.windowStart))} – ${format.format(
    new Date(window.windowEnd),
  )}`;
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
</script>

<template>
  <ClinicDialog
    :open="open"
    title="تغيير الموعد"
    :subject="appointment?.child.fullName"
    @close="emit('close')"
  >
    <p class="reschedule__intro">
      اختاري فترة وصول جديدة. السعة المعروضة لحظية، والخادم يؤكد آخر مكان عند
      الحفظ.
    </p>

    <p
      v-if="failure"
      class="dnotice dnotice--error"
      role="alert"
    >
      {{ failure }}
    </p>

    <p
      v-if="loading"
      class="reschedule__state"
    >
      جارٍ تحميل الفترات المتاحة…
    </p>

    <div
      v-else-if="availableDays.length"
      class="reschedule__days"
    >
      <section
        v-for="day in availableDays"
        :key="day.date"
        class="reschedule__day"
      >
        <h3>{{ dateLabel(day.date) }}</h3>
        <div class="reschedule__windows">
          <button
            v-for="window in day.windows"
            :key="window.windowStart"
            class="reschedule__window"
            :class="{
              'reschedule__window--selected':
                selected?.windowStart === window.windowStart,
            }"
            type="button"
            @click="selected = window"
          >
            <strong>{{ windowLabel(window) }}</strong>
            <span>
              {{ arabicDigits(window.remaining) }} من
              {{ arabicDigits(window.capacity) }} متاح
            </span>
          </button>
        </div>
      </section>
    </div>

    <p
      v-else
      class="reschedule__state"
    >
      لا توجد فترات متاحة خلال الأيام السبعة القادمة.
    </p>

    <template #actions>
      <button
        class="dbtn dbtn--ghost"
        type="button"
        :disabled="saving"
        @click="emit('close')"
      >
        تراجع
      </button>
      <button
        class="dbtn dbtn--teal"
        type="button"
        :disabled="selected === null || saving"
        @click="submit"
      >
        {{ saving ? 'جارٍ الحفظ…' : 'تأكيد الموعد الجديد' }}
      </button>
    </template>
  </ClinicDialog>
</template>

<style scoped>
.reschedule__intro {
  color: var(--ink-2);
  line-height: 1.75;
}

.reschedule__days {
  display: grid;
  gap: 18px;
  max-height: min(52vh, 520px);
  overflow-y: auto;
  padding-inline-end: 4px;
}

.reschedule__day {
  display: grid;
  gap: 9px;
}

.reschedule__day h3 {
  font-size: 14px;
}

.reschedule__windows {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.reschedule__window {
  display: grid;
  gap: 2px;
  padding: 11px 12px;
  border: 1.5px solid var(--line);
  border-radius: 13px;
  color: var(--ink);
  background: var(--surface-2);
  font-family: var(--ff-body);
  text-align: start;
  cursor: pointer;
}

.reschedule__window span {
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 700;
}

.reschedule__window--selected {
  border-color: var(--teal);
  color: var(--teal-ink);
  background: var(--teal-soft);
}

.reschedule__window:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--teal) 35%, transparent);
  outline-offset: 2px;
}

.reschedule__state {
  padding: 24px;
  border-radius: 14px;
  color: var(--ink-2);
  background: var(--surface-2);
  text-align: center;
}

@media (max-width: 560px) {
  .reschedule__windows {
    grid-template-columns: 1fr;
  }
}
</style>
