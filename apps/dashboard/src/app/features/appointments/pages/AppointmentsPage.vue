<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { RouterLink } from 'vue-router';
import {
  AppointmentStatus,
  ClinicMemberRole,
  type Appointment,
  type AppointmentListItem,
  type RescheduledAppointment,
  type StaffEstimateDiagnostic,
} from '@clinic/contracts';
import { apiMessage } from '../../../shared/messages';
import { arabicDigits } from '../../../shared/numerals';
import { clinicApi, config, session } from '../../../runtime';
import { useStaffAppointments } from '../composables/useStaffAppointments';
import AppointmentIdentity from '../components/AppointmentIdentity.vue';
import RescheduleAppointmentDialog from '../components/RescheduleAppointmentDialog.vue';
import AppointmentEstimateDiagnostic from '../components/AppointmentEstimateDiagnostic.vue';

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
const working = ref<string | null>(null);
const rescheduling = ref<AppointmentListItem | null>(null);
const diagnostic = shallowRef<StaffEstimateDiagnostic | null>(null);
const trackingLink = shallowRef<string | null>(null);
const query = shallowRef('');
const statusFilter = shallowRef<string>('all');
const viewMode = shallowRef<'day' | 'week' | 'month'>('day');

const clinic = computed(() => state.identity?.clinic ?? null);
const timezone = computed(() => clinic.value?.timezone ?? 'Africa/Cairo');

const canBook = computed(
  () =>
    state.identity?.member.role === ClinicMemberRole.Reception ||
    state.identity?.member.role === ClinicMemberRole.Admin,
);

const filtered = computed(() => {
  const term = query.value.trim().toLocaleLowerCase('ar');
  return items.value.filter((appointment) => {
    const matchesStatus =
      statusFilter.value === 'all' || appointment.status === statusFilter.value;
    const matchesSearch =
      term.length === 0 ||
      appointment.child.fullName.toLocaleLowerCase('ar').includes(term) ||
      appointment.guardian.fullName.toLocaleLowerCase('ar').includes(term) ||
      appointment.guardian.phoneE164.includes(term);
    return matchesStatus && matchesSearch;
  });
});

const pending = computed(() =>
  filtered.value.filter((a) => a.status === AppointmentStatus.Requested),
);
const rest = computed(() =>
  filtered.value.filter((a) => a.status !== AppointmentStatus.Requested),
);

const FILTERS = [
  { value: 'all', label: 'الكل' },
  { value: AppointmentStatus.Requested, label: 'بانتظار الموافقة' },
  { value: AppointmentStatus.Confirmed, label: 'مؤكد' },
  { value: AppointmentStatus.CheckedIn, label: 'في العيادة' },
  { value: AppointmentStatus.Completed, label: 'مكتمل' },
  { value: AppointmentStatus.Cancelled, label: 'ملغي' },
  { value: AppointmentStatus.NoShow, label: 'لم يحضر' },
] as const;

const VIEW_MODES = [
  { value: 'day', label: 'يوم' },
  { value: 'week', label: 'أسبوع' },
  { value: 'month', label: 'شهر' },
] as const;

const listTitle = computed(() => {
  switch (viewMode.value) {
    case 'week':
      return 'مواعيد الأسبوع';
    case 'month':
      return 'مواعيد الشهر';
    default:
      return 'مواعيد اليوم';
  }
});

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
  const time = `${format.format(new Date(appointment.windowStart))} – ${format.format(
    new Date(appointment.windowEnd),
  )}`;
  if (viewMode.value === 'day') return time;
  const day = new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'short',
    timeZone: timezone.value,
  }).format(new Date(appointment.windowStart));
  return `${day} · ${time}`;
}

const { items, loading, failure, load, refresh, polling } =
  useStaffAppointments(() => calendarRange(date.value, viewMode.value));

/** Fold command state into the read model without dropping its identity data. */
async function run(
  id: string,
  command: (id: string) => Promise<Appointment>,
): Promise<void> {
  working.value = id;
  failure.value = null;
  try {
    const updated = await command(id);
    items.value = items.value.map((appointment) =>
      appointment.id === updated.id
        ? { ...appointment, ...updated }
        : appointment,
    );
    // The row is already right; this catches what the command changed around
    // it — a freed seat, a request that is no longer pending.
    void refresh();
  } catch (error) {
    failure.value = apiMessage(error);
    // The row moved underneath us — re-read rather than leave a stale table.
    await load();
  } finally {
    working.value = null;
  }
}

function trackingUrl(token: string): string {
  return `${config.mobileAppUrl.replace(/\/$/, '')}/track#${token}`;
}

async function copyTrackingLink(link: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    // The visible readonly field remains the fallback on browsers that deny
    // clipboard access (for example, a non-secure local origin).
  }
}

async function issueTrackingLink(id: string): Promise<void> {
  working.value = id;
  failure.value = null;
  try {
    const capability = await clinicApi.createTrackingLink(id);
    trackingLink.value = trackingUrl(capability.token);
    await copyTrackingLink(trackingLink.value);
  } catch (error) {
    failure.value = apiMessage(error);
  } finally {
    working.value = null;
  }
}

function acceptReschedule(updated: RescheduledAppointment): void {
  const original = rescheduling.value;
  rescheduling.value = null;
  if (original === null) return;
  if (updated.trackingLinkRotation) {
    trackingLink.value = trackingUrl(updated.trackingLinkRotation.token);
    void copyTrackingLink(trackingLink.value);
  }
  items.value = items.value.map((appointment) =>
    appointment.id === original.id
      ? {
          ...original,
          ...updated,
          child: original.child,
          guardian: original.guardian,
          isLate: false,
        }
      : appointment,
  );
}

async function inspectEstimate(id: string): Promise<void> {
  working.value = id;
  try {
    diagnostic.value = await clinicApi.trackingDiagnostic(id);
    failure.value = null;
  } catch (error) {
    failure.value = apiMessage(error);
  } finally {
    working.value = null;
  }
}

watch([date, viewMode], load);
onMounted(() => {
  date.value = clinic.value?.today ?? '';
  polling.start();
});

function calendarRange(
  selected: string,
  mode: 'day' | 'week' | 'month',
): { from?: string; to?: string } {
  if (!selected) return {};
  if (mode === 'day') return { from: selected };
  const value = new Date(`${selected}T12:00:00Z`);
  if (mode === 'week') {
    value.setUTCDate(value.getUTCDate() + 6);
    return { from: selected, to: value.toISOString().slice(0, 10) };
  }
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth();
  const from = new Date(Date.UTC(year, month, 1, 12));
  const to = new Date(Date.UTC(year, month + 1, 0, 12));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}
</script>

<template>
  <div class="dstack">
    <div class="toolbar">
      <div class="dtabs toolbar__modes" aria-label="نطاق عرض المواعيد">
        <button
          v-for="mode in VIEW_MODES"
          :key="mode.value"
          type="button"
          :class="{ on: viewMode === mode.value }"
          @click="viewMode = mode.value"
        >
          {{ mode.label }}
        </button>
      </div>
      <div class="toolbar__date">
        <label class="dfield__label" for="appointments-day">اليوم</label>
        <input
          id="appointments-day"
          v-model="date"
          class="dinput day"
          type="date"
        />
      </div>
      <label class="toolbar__search">
        <span class="sr-only">البحث في المواعيد</span>
        <input
          v-model="query"
          class="dinput"
          type="search"
          placeholder="ابحثي باسم الطفل أو ولي الأمر"
        />
      </label>
      <RouterLink
        v-if="canBook"
        class="dbtn dbtn--primary"
        :to="{ name: 'reception-booking' }"
      >
        موعد يدوي جديد
      </RouterLink>
    </div>

    <div class="dtabs appointment-filters" aria-label="تصفية حالة الموعد">
      <button
        v-for="filter in FILTERS"
        :key="filter.value"
        type="button"
        :class="{ on: statusFilter === filter.value }"
        @click="statusFilter = filter.value"
      >
        {{ filter.label }}
      </button>
    </div>

    <p v-if="failure" class="dnotice dnotice--error" role="alert">
      {{ failure }}
    </p>

    <section v-if="trackingLink" class="dnotice tracking-link" role="status">
      <div>
        <strong>رابط متابعة الأسرة جاهز</strong>
        <p>انسخي الرابط وأرسليه للأسرة. الرابط القديم يُلغى تلقائيًا عند تدويره.</p>
      </div>
      <input class="dinput" :value="trackingLink" readonly dir="ltr" />
      <button class="dbtn dbtn--soft dbtn--sm" @click="copyTrackingLink(trackingLink)">
        نسخ الرابط
      </button>
      <button class="dbtn dbtn--ghost dbtn--sm" @click="trackingLink = null">
        إغلاق
      </button>
    </section>

    <div v-if="loading" class="dcard dcard--pad centre">جارٍ التحميل…</div>

    <template v-else>
      <AppointmentEstimateDiagnostic
        v-if="diagnostic"
        :diagnostic="diagnostic"
        :timezone="timezone"
        @close="diagnostic = null"
      />
      <!-- The only rows that need a decision. -->
      <section v-if="pending.length > 0" class="dcard">
        <header class="dcard__head">
          <h2 class="dcard__title">طلبات بانتظار الموافقة</h2>
          <span class="dpill dpill--warn">
            {{ arabicDigits(pending.length) }}
          </span>
        </header>

        <div class="dtable">
          <div
            v-for="appointment in pending"
            :key="appointment.id"
            class="dtable__row row row--pending"
            :data-appointment-id="appointment.id"
          >
            <AppointmentIdentity
              :child="appointment.child"
              :guardian="appointment.guardian"
            />
            <span class="row__time">{{ windowLabel(appointment) }}</span>
            <span class="row__type">
              {{ VISIT_LABEL[appointment.visitType] ?? appointment.visitType }}
            </span>
            <div class="row__actions">
              <button
                class="dbtn dbtn--ghost dbtn--sm"
                :disabled="working === appointment.id"
                @click="inspectEstimate(appointment.id)"
              >التقدير</button>
              <button
                v-if="
                  appointment.status === 'requested' ||
                  appointment.status === 'confirmed'
                "
                class="dbtn dbtn--soft dbtn--sm"
                :disabled="working === appointment.id"
                @click="rescheduling = appointment"
              >
                تغيير الموعد
              </button>
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

      <section v-if="rest.length > 0 || pending.length === 0" class="dcard">
        <header class="dcard__head">
          <h2 class="dcard__title">
            {{ listTitle }}
          </h2>
          <span class="dpill">{{ arabicDigits(rest.length) }}</span>
        </header>

        <div
          v-if="rest.length === 0 && pending.length === 0"
          class="dcard--pad dmuted"
        >
          لا توجد مواعيد تطابق البحث أو الفلتر الحالي.
        </div>

        <div v-else class="dtable">
          <div class="dtable__row dtable__row--head row">
            <span>المريض</span>
            <span>الفترة</span>
            <span>نوع الزيارة</span>
            <span>الحالة</span>
            <span />
          </div>
          <div
            v-for="appointment in rest"
            :key="appointment.id"
            class="dtable__row row"
            :data-appointment-id="appointment.id"
          >
            <AppointmentIdentity
              :child="appointment.child"
              :guardian="appointment.guardian"
            />
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
                class="dbtn dbtn--soft dbtn--sm"
                :disabled="working === appointment.id"
                @click="inspectEstimate(appointment.id)"
              >التقدير</button>
              <button
                v-if="canBook && appointment.status === 'confirmed'"
                class="dbtn dbtn--soft dbtn--sm"
                :disabled="working === appointment.id"
                @click="issueTrackingLink(appointment.id)"
              >رابط المتابعة</button>
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

    <RescheduleAppointmentDialog
      :open="rescheduling !== null"
      :appointment="rescheduling"
      :timezone="timezone"
      :today="clinic?.today ?? date"
      @close="rescheduling = null"
      @rescheduled="acceptReschedule"
    />
  </div>
</template>

<style scoped>
.toolbar {
  display: grid;
  grid-template-columns: auto auto minmax(220px, 1fr) auto;
  align-items: end;
  gap: 12px;
}

.tracking-link {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(260px, 2fr) auto auto;
  align-items: center;
  gap: 10px;
}

.tracking-link p { margin: 4px 0 0; }

@media (max-width: 900px) {
  .tracking-link { grid-template-columns: 1fr; }
}

.toolbar__modes {
  align-self: end;
}

.toolbar__date {
  display: grid;
  gap: 6px;
}

.toolbar__search {
  display: block;
}

.day {
  width: 190px;
}

.appointment-filters {
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.centre {
  text-align: center;
  color: var(--ink-2);
}

.row {
  grid-template-columns: minmax(180px, 1.3fr) 150px 1fr 120px auto;
}

.row--pending {
  grid-template-columns: minmax(180px, 1.3fr) 150px 1fr auto;
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
  .toolbar {
    grid-template-columns: 1fr;
  }

  .day {
    width: 100%;
  }

  .row {
    grid-template-columns: 1fr 1fr;
    row-gap: 8px;
  }
}
</style>
