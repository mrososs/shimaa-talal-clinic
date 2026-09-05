<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { AppointmentStatus, type Appointment } from '@clinic/contracts';
import { apiMessage } from '../../../shared/messages';
import { arabicDigits } from '../../../shared/numerals';
import { clinicApi, session } from '../../../runtime';

/**
 * The clinic's day: who is coming, and what still needs deciding.
 *
 * Ordered by arrival window, which is the order the desk actually works in. The
 * pending requests sit at the top because they are the only rows that need a
 * decision — everything else is just the day.
 *
 * Commands are explicit buttons, not a status dropdown. A dropdown invites an
 * illegal transition and then has to explain why it was refused; a button that
 * only appears when the move is legal never raises the question.
 */

const state = session.state;

const date = ref('');
const items = ref<Appointment[]>([]);
const loading = ref(true);
const failure = ref<string | null>(null);
const working = ref<string | null>(null);

const clinic = computed(() => state.identity?.clinic ?? null);
const timezone = computed(() => clinic.value?.timezone ?? 'Africa/Cairo');

const pending = computed(() =>
  items.value.filter((a) => a.status === AppointmentStatus.Requested),
);
const rest = computed(() =>
  items.value.filter((a) => a.status !== AppointmentStatus.Requested),
);

const STATUS: Record<string, { label: string; tone: string }> = {
  requested: { label: 'قيد المراجعة', tone: 'warn' },
  confirmed: { label: 'مؤكّد', tone: 'ok' },
  checked_in: { label: 'في العيادة', tone: 'ok' },
  completed: { label: 'تمت', tone: '' },
  cancelled: { label: 'ملغي', tone: 'danger' },
  no_show: { label: 'لم يحضر', tone: 'danger' },
};

const VISIT_LABEL: Record<string, string> = {
  new_visit: 'كشف جديد',
  follow_up: 'متابعة',
  vaccination: 'تطعيم',
  consultation: 'استشارة',
  newborn: 'حديث الولادة',
};

function windowLabel(appointment: Appointment): string {
  const format = new Intl.DateTimeFormat('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone.value,
  });
  return `${format.format(new Date(appointment.windowStart))} – ${format.format(
    new Date(appointment.windowEnd),
  )}`;
}

async function load(): Promise<void> {
  loading.value = true;
  failure.value = null;
  try {
    items.value = await clinicApi.appointments(date.value || undefined);
  } catch (error) {
    failure.value = apiMessage(error);
  } finally {
    loading.value = false;
  }
}

/** Run a command and fold the fresh row back in, so the table self-heals. */
async function run(
  id: string,
  command: (id: string) => Promise<Appointment>,
): Promise<void> {
  working.value = id;
  failure.value = null;
  try {
    const updated = await command(id);
    items.value = items.value.map((a) => (a.id === updated.id ? updated : a));
  } catch (error) {
    failure.value = apiMessage(error);
    // The row moved underneath us — re-read rather than leave a stale table.
    await load();
  } finally {
    working.value = null;
  }
}

watch(date, load);
onMounted(() => {
  date.value = clinic.value?.today ?? '';
  void load();
});
</script>

<template>
  <div class="dstack">
    <div class="drow toolbar">
      <label class="dfield__label">اليوم</label>
      <input
        v-model="date"
        class="dinput day"
        type="date"
      >
      <button
        class="dbtn dbtn--ghost dbtn--sm"
        @click="load"
      >
        تحديث
      </button>
    </div>

    <p
      v-if="failure"
      class="dnotice dnotice--error"
      role="alert"
    >
      {{ failure }}
    </p>

    <div
      v-if="loading"
      class="dcard dcard--pad centre"
    >
      جارٍ التحميل…
    </div>

    <template v-else>
      <!-- The only rows that need a decision. -->
      <section
        v-if="pending.length > 0"
        class="dcard"
      >
        <header class="dcard__head">
          <h2 class="dcard__title">
            طلبات بانتظار الموافقة
          </h2>
          <span class="dpill dpill--warn">
            {{ arabicDigits(pending.length) }}
          </span>
        </header>

        <div class="dtable">
          <div
            v-for="appointment in pending"
            :key="appointment.id"
            class="dtable__row row"
          >
            <span class="row__time">{{ windowLabel(appointment) }}</span>
            <span class="row__type">
              {{ VISIT_LABEL[appointment.visitType] ?? appointment.visitType }}
            </span>
            <div class="row__actions">
              <button
                class="dbtn dbtn--teal dbtn--sm"
                :disabled="working === appointment.id"
                @click="run(appointment.id, clinicApi.approve)"
              >
                موافقة
              </button>
              <button
                class="dbtn dbtn--ghost dbtn--sm"
                :disabled="working === appointment.id"
                @click="run(appointment.id, (id) => clinicApi.reject(id))"
              >
                رفض
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="dcard">
        <header class="dcard__head">
          <h2 class="dcard__title">
            مواعيد اليوم
          </h2>
          <span class="dpill">{{ arabicDigits(rest.length) }}</span>
        </header>

        <div
          v-if="rest.length === 0"
          class="dcard--pad dmuted"
        >
          لا توجد مواعيد في هذا اليوم.
        </div>

        <div
          v-else
          class="dtable"
        >
          <div class="dtable__row dtable__row--head row">
            <span>الفترة</span>
            <span>نوع الزيارة</span>
            <span>الحالة</span>
            <span />
          </div>
          <div
            v-for="appointment in rest"
            :key="appointment.id"
            class="dtable__row row"
          >
            <span class="row__time">{{ windowLabel(appointment) }}</span>
            <span class="row__type">
              {{ VISIT_LABEL[appointment.visitType] ?? appointment.visitType }}
            </span>
            <span
              class="dpill"
              :class="
                STATUS[appointment.status]?.tone
                  ? `dpill--${STATUS[appointment.status].tone}`
                  : ''
              "
            >
              {{ STATUS[appointment.status]?.label ?? appointment.status }}
            </span>
            <div class="row__actions">
              <button
                v-if="appointment.status === 'confirmed'"
                class="dbtn dbtn--ghost dbtn--sm"
                :disabled="working === appointment.id"
                @click="run(appointment.id, clinicApi.markNoShow)"
              >
                لم يحضر
              </button>
              <button
                v-if="
                  appointment.status === 'confirmed' ||
                    appointment.status === 'checked_in'
                "
                class="dbtn dbtn--ghost dbtn--sm"
                :disabled="working === appointment.id"
                @click="run(appointment.id, (id) => clinicApi.cancel(id))"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.toolbar {
  gap: 10px;
}

.day {
  width: 190px;
}

.centre {
  text-align: center;
  color: var(--ink-2);
}

.row {
  grid-template-columns: 150px 1fr 120px auto;
}

.row__time {
  font-family: var(--ff-display);
  font-weight: 800;
}

.row__type {
  color: var(--ink-2);
  font-weight: 600;
}

.row__actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

@media (max-width: 860px) {
  .row {
    grid-template-columns: 1fr 1fr;
    row-gap: 8px;
  }
}
</style>
