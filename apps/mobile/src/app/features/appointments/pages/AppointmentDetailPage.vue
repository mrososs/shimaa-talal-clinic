<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonButton,
  IonSpinner,
  onIonViewDidLeave,
  onIonViewWillEnter,
} from '@ionic/vue';
import { AppointmentStatus, PaymentStatus } from '@clinic/contracts';
import { ClinicDialog } from '@clinic/client-ui';
import ScreenShell from '../../../shared/components/ScreenShell.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { dayLabel, windowLabel } from '../../../shared/format';
import { session } from '../../../runtime';
import { useAppointmentDetail } from '../composables/useAppointmentDetail';
import { useParentPayments } from '../../payments/composables/useParentPayments';

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
const detail = useAppointmentDetail(() =>
  String(route.params['appointmentId']),
);
const appointment = detail.appointment;
const payments = useParentPayments(() => appointment.value?.id ?? null);

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

/**
 * Once reception has checked them in, the queue is where the answer is.
 *
 * The link only appears in that state. Offering it earlier would suggest a
 * turn exists before anybody has arrived, which is the confusion the whole
 * appointment-versus-queue split exists to avoid.
 */
const inClinic = computed(
  () => appointment.value?.status === AppointmentStatus.CheckedIn,
);

/** Only a live appointment can still be called off. */
const canCancel = computed(
  () =>
    appointment.value?.status === AppointmentStatus.Requested ||
    appointment.value?.status === AppointmentStatus.Confirmed,
);

const canPay = computed(
  () =>
    appointment.value?.status === AppointmentStatus.Requested ||
    appointment.value?.status === AppointmentStatus.Confirmed ||
    appointment.value?.status === AppointmentStatus.CheckedIn,
);

const currentPayment = computed(
  () =>
    payments.view.value.items.find(
      (payment) => payment.appointmentId === appointment.value?.id,
    ) ?? null,
);
const paidNoShow = computed(
  () =>
    appointment.value?.status === AppointmentStatus.NoShow &&
    currentPayment.value?.status === PaymentStatus.Paid,
);

/**
 * Cancelling is asked about first.
 *
 * It gives up a seat somebody else can take, and the clinic's cutoff may make
 * it final. That question used to be a bare button; it is now the same dialog
 * the clinic staff see, in Arabic and right-to-left, rather than the browser's.
 */
const confirming = shallowRef(false);

async function cancel(): Promise<void> {
  confirming.value = false;
  await detail.cancel();
}

onIonViewWillEnter(() => void Promise.all([detail.open(), payments.open()]));
onIonViewDidLeave(() => {
  detail.close();
  payments.close();
});
</script>

<template>
  <screen-shell title="تفاصيل الموعد" :back-to="{ name: 'appointments' }">
    <div v-if="detail.loading.value" class="card card--centre">
      <ion-spinner name="crescent" />
    </div>

    <div v-else-if="appointment" class="stack">
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

      <p v-if="STATUS[appointment.status]?.note" class="card note">
        {{ STATUS[appointment.status].note }}
      </p>

      <form-notice :message="detail.failure.value" />

      <div v-if="canPay" class="actions">
        <ion-button
          expand="block"
          @click="
            router.push({
              name: 'payments',
              query: { appointmentId: appointment.id },
            })
          "
        >
          الدفع لهذا الموعد
        </ion-button>
      </div>

      <div v-if="inClinic" class="actions">
        <ion-button expand="block" @click="router.replace({ name: 'queue' })">
          متابعة دورك في الطابور
        </ion-button>
      </div>

      <div v-else-if="canCancel" class="actions">
        <ion-button
          expand="block"
          fill="outline"
          :disabled="detail.working.value"
          @click="
            router.push({
              name: 'appointment-reschedule',
              params: { appointmentId: appointment.id },
            })
          "
        >
          تغيير الموعد
        </ion-button>
        <ion-button
          expand="block"
          fill="outline"
          color="danger"
          :disabled="detail.working.value"
          @click="confirming = true"
        >
          <ion-spinner v-if="detail.working.value" name="crescent" />
          <span v-else>إلغاء الموعد</span>
        </ion-button>
      </div>

      <div v-else-if="paidNoShow" class="actions">
        <p class="card note note--credit">
          دفعك محفوظ، وسينتقل تلقائياً إلى الموعد الجديد دون تحصيل مبلغ آخر.
        </p>
        <ion-button
          expand="block"
          @click="
            router.push({
              name: 'appointment-reschedule',
              params: { appointmentId: appointment.id },
            })
          "
        >
          نقل الموعد مع الاحتفاظ بالدفع
        </ion-button>
      </div>

      <div v-else class="actions">
        <ion-button expand="block" @click="router.replace({ name: 'booking' })">
          حجز موعد جديد
        </ion-button>
      </div>
    </div>

    <form-notice v-else :message="detail.failure.value" />

    <clinic-dialog
      :open="confirming"
      title="إلغاء الموعد"
      :subject="appointment ? dayLabel(appointment.windowStart) : undefined"
      @close="confirming = false"
    >
      <p class="muted confirm">
        سيُلغى هذا الموعد ويُتاح مكانه لعائلة أخرى. يمكنك الحجز من جديد في أي
        وقت.
      </p>

      <template #actions>
        <ion-button fill="outline" size="small" @click="confirming = false">
          تراجع
        </ion-button>
        <ion-button color="danger" size="small" @click="cancel">
          تأكيد الإلغاء
        </ion-button>
      </template>
    </clinic-dialog>
  </screen-shell>
</template>

<style scoped>
.confirm {
  margin: 0;
  font-size: 14px;
}

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
