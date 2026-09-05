<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonButton, IonSpinner } from '@ionic/vue';
import { AppointmentStatus, type Appointment } from '@clinic/contracts';
import ScreenShell from '../../../shared/components/ScreenShell.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { dayLabel, windowLabel } from '../../../shared/format';
import { apiMessage } from '../../../shared/messages';
import { bookingApi, session } from '../../../runtime';

/**
 * One visit: when, for whom, and what can still be done about it.
 *
 * The `requested` state is a real screen, not a footnote — the design gives it
 * its own card ("قيد المراجعة") because a parent who has asked for a slot and
 * not yet been accepted needs to be told that plainly.
 *
 * Cancelling can be refused by the clinic's cutoff. That refusal arrives from
 * the server, which is the only place that rule lives, and it is shown as a
 * sentence rather than hidden by disabling the button — a disabled button with
 * no explanation is the same as a broken one.
 */

const route = useRoute();
const router = useRouter();
const state = session.state;

const appointment = ref<Appointment | null>(null);
const loading = ref(true);
const working = ref(false);
const failure = ref<string | null>(null);

const timezone = computed(() => state.identity?.clinic.timezone);
const childName = computed(() => {
  const id = appointment.value?.childId;
  return (
    state.identity?.children.find((child) => child.id === id)?.fullName ??
    'الطفل'
  );
});

const VISIT_LABEL: Record<string, string> = {
  new_visit: 'كشف جديد',
  follow_up: 'متابعة',
  vaccination: 'تطعيم',
  consultation: 'استشارة',
  newborn: 'حديث الولادة',
};

const STATUS: Record<string, { label: string; note: string; tone: string }> = {
  requested: {
    label: 'قيد المراجعة',
    note: 'أرسلنا طلبك للعيادة. سنخبرك فور تأكيده.',
    tone: 'warn',
  },
  confirmed: {
    label: 'مؤكّد',
    note: 'موعدك مؤكّد. يرجى الحضور خلال الفترة المحددة.',
    tone: 'ok',
  },
  checked_in: {
    label: 'في العيادة',
    note: 'تم تسجيل حضورك. تابعي دورك من صفحة الطابور.',
    tone: 'ok',
  },
  completed: { label: 'تمت الزيارة', note: '', tone: 'muted' },
  cancelled: { label: 'ملغي', note: 'تم إلغاء هذا الموعد.', tone: 'danger' },
  no_show: { label: 'لم يتم الحضور', note: '', tone: 'danger' },
};

/** Only a live appointment can still be called off. */
const canCancel = computed(
  () =>
    appointment.value?.status === AppointmentStatus.Requested ||
    appointment.value?.status === AppointmentStatus.Confirmed,
);

async function load(): Promise<void> {
  loading.value = true;
  failure.value = null;
  try {
    appointment.value = await bookingApi.detail(
      String(route.params['appointmentId']),
    );
  } catch (error) {
    failure.value = apiMessage(error);
  } finally {
    loading.value = false;
  }
}

async function cancel(): Promise<void> {
  if (appointment.value === null) return;
  working.value = true;
  failure.value = null;
  try {
    appointment.value = await bookingApi.cancel(appointment.value.id);
  } catch (error) {
    failure.value = apiMessage(error);
  } finally {
    working.value = false;
  }
}

onMounted(load);
</script>

<template>
  <screen-shell
    title="تفاصيل الموعد"
    :back-to="{ name: 'appointments' }"
  >
    <div
      v-if="loading"
      class="card card--centre"
    >
      <ion-spinner name="crescent" />
    </div>

    <div
      v-else-if="appointment"
      class="stack"
    >
      <section class="card visit">
        <span
          class="chip"
          :class="`chip--${STATUS[appointment.status]?.tone ?? 'muted'}`"
        >
          {{ STATUS[appointment.status]?.label ?? appointment.status }}
        </span>

        <h2 class="visit__child">
          {{ childName }}
        </h2>
        <p class="visit__day">
          {{ dayLabel(appointment.windowStart, timezone) }}
        </p>
        <p class="visit__window">
          {{
            windowLabel(
              appointment.windowStart,
              appointment.windowEnd,
              timezone,
            )
          }}
        </p>
        <p class="subtitle visit__reason">
          {{ VISIT_LABEL[appointment.visitType] ?? appointment.visitType }}
        </p>
      </section>

      <p
        v-if="STATUS[appointment.status]?.note"
        class="card note"
      >
        {{ STATUS[appointment.status].note }}
      </p>

      <form-notice :message="failure" />

      <div
        v-if="canCancel"
        class="actions"
      >
        <ion-button
          expand="block"
          fill="outline"
          color="danger"
          :disabled="working"
          @click="cancel"
        >
          <ion-spinner
            v-if="working"
            name="crescent"
          />
          <span v-else>إلغاء الموعد</span>
        </ion-button>
      </div>

      <div
        v-else
        class="actions"
      >
        <ion-button
          expand="block"
          @click="router.replace({ name: 'booking' })"
        >
          حجز موعد جديد
        </ion-button>
      </div>
    </div>

    <form-notice
      v-else
      :message="failure"
    />
  </screen-shell>
</template>

<style scoped>
.card--centre {
  display: grid;
  place-items: center;
  min-height: 140px;
}

.visit {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 20px;
}

.visit__child {
  font-family: var(--ff-display);
  font-size: 22px;
  font-weight: 800;
  margin: 6px 0 0;
}

.visit__day {
  margin: 0;
  font-weight: 700;
}

.visit__window {
  margin: 0;
  font-family: var(--ff-display);
  font-size: 18px;
  font-weight: 800;
  color: var(--coral-ink);
}

.visit__reason {
  margin-block-start: 4px;
  font-size: 13px;
}

.note {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink-2);
  line-height: 1.7;
}

.chip--ok {
  background: var(--teal-soft);
  color: var(--teal-ink);
  border-color: transparent;
}

.chip--warn {
  background: var(--sun-soft);
  color: #8a6212;
  border-color: transparent;
}

.chip--danger {
  background: #fde6e6;
  color: var(--danger);
  border-color: transparent;
}
</style>
