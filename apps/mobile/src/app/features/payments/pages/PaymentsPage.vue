<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  onIonViewDidLeave,
  onIonViewWillEnter,
  type RefresherCustomEvent,
} from '@ionic/vue';
import {
  cashOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  hourglassOutline,
  refreshOutline,
} from 'ionicons/icons';
import ScreenShell from '../../../shared/components/ScreenShell.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { shortDayLabel } from '../../../shared/format';
import BookingPaymentSteps from '../components/BookingPaymentSteps.vue';
import PaymentAppointmentList from '../components/PaymentAppointmentList.vue';
import PaymentInvoiceCard from '../components/PaymentInvoiceCard.vue';
import PaymentMethodPanel from '../components/PaymentMethodPanel.vue';
import PaymentSuccessSheet from '../components/PaymentSuccessSheet.vue';
import { useParentPayments } from '../composables/useParentPayments';

const route = useRoute();
const router = useRouter();
const payments = useParentPayments(() => {
  const value = route.query['appointmentId'];
  return typeof value === 'string' ? value : null;
});

const history = computed(() => payments.view.value.items);

/**
 * Whether the method panel's fixed action button is on screen — the same
 * condition the template renders it under. The page reserves room for it at the
 * end of the scroll, so the last payment row is never trapped beneath it; with
 * nothing to pay there is no button, and reserving the space would only leave a
 * gap under the history.
 */
const showsStickyAction = computed(
  () =>
    payments.view.value.payableAppointments.length > 0 &&
    payments.selected.value !== null,
);
const STATUS: Record<string, { label: string; icon: string; tone: string }> = {
  pending: { label: 'قيد المراجعة', icon: hourglassOutline, tone: 'pending' },
  paid: { label: 'تم الدفع', icon: checkmarkCircleOutline, tone: 'paid' },
  failed: { label: 'مرفوض', icon: closeCircleOutline, tone: 'failed' },
  refunded: { label: 'تم الاسترداد', icon: refreshOutline, tone: 'refunded' },
};
const METHOD: Record<string, string> = {
  cash: 'نقداً في العيادة',
  instapay: 'InstaPay',
};

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

async function refresh(event?: RefresherCustomEvent): Promise<void> {
  await payments.refresh();
  await event?.target.complete();
}

onIonViewWillEnter(() => void payments.open());
onIonViewDidLeave(() => payments.close());
</script>

<template>
  <screen-shell
    title="الدفع"
    subtitle="الخطوة الأخيرة — اختاري طريقة الدفع"
    :back-to="{ name: 'home' }"
  >
    <template #above>
      <ion-refresher slot="fixed" @ion-refresh="refresh($event)"
        ><ion-refresher-content
      /></ion-refresher>
    </template>
    <div
      class="payments"
      :class="{ 'payments--has-sticky-action': showsStickyAction }"
    >
      <form-notice :message="payments.failure.value" />
      <div v-if="payments.loading.value" class="card loading">
        <ion-spinner name="crescent" />
      </div>
      <template v-else>
        <template v-if="payments.view.value.payableAppointments.length > 0">
          <booking-payment-steps />
          <payment-appointment-list
            v-if="payments.view.value.payableAppointments.length > 1"
            :appointments="payments.view.value.payableAppointments"
            :selected-id="payments.selectedId.value"
            @select="payments.select"
          />
          <template v-if="payments.selected.value">
            <payment-invoice-card :appointment="payments.selected.value" />
            <payment-method-panel
              :appointment="payments.selected.value"
              :instapay-handle="payments.view.value.instapayHandle"
              :working="payments.working.value"
              @cash="payments.registerCash"
              @instapay="payments.registerInstapay"
            />
          </template>
        </template>
        <section v-else class="card empty">
          <span class="empty__icon"><ion-icon :icon="cashOutline" /></span>
          <strong>لا توجد مواعيد تحتاج إلى دفع الآن</strong>
          <p>ستظهر هنا المواعيد المؤهلة بمجرد حجزها.</p>
        </section>
        <section v-if="history.length > 0" class="history-list">
          <h2 class="section-title">عمليات الدفع</h2>
          <article
            v-for="payment in history"
            :key="payment.id"
            class="card history"
          >
            <span
              class="history__icon"
              :class="`history__icon--${STATUS[payment.status]?.tone ?? 'pending'}`"
            >
              <ion-icon
                :icon="STATUS[payment.status]?.icon ?? hourglassOutline"
              />
            </span>
            <div class="history__copy">
              <strong>{{ METHOD[payment.method] ?? payment.method }}</strong>
              <small>{{ shortDayLabel(payment.createdAt) }}</small>
            </div>
            <div class="history__end">
              <strong>{{
                money(payment.amountMinor, payment.currency)
              }}</strong>
              <span
                :class="`history__status history__status--${STATUS[payment.status]?.tone ?? 'pending'}`"
              >
                {{ STATUS[payment.status]?.label ?? payment.status }}
              </span>
            </div>
          </article>
        </section>
      </template>
    </div>
    <payment-success-sheet
      v-if="payments.lastResult.value"
      :result="payments.lastResult.value"
      @track="router.replace({ name: 'queue' })"
    />
  </screen-shell>
</template>

<style scoped>
.payments {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
/*
 * Clears the method panel's fixed action button, which overlays the bottom of
 * the viewport: 56px button + its 28px/14px gradient padding, plus the device
 * inset. Without it the final payment row cannot be scrolled out from under it.
 */
.payments--has-sticky-action {
  padding-block-end: calc(98px + env(safe-area-inset-bottom));
}
.loading {
  min-height: 160px;
  display: grid;
  place-items: center;
}
.empty {
  padding: 30px 22px;
  display: grid;
  justify-items: center;
  gap: 7px;
  text-align: center;
}
.empty__icon {
  inline-size: 58px;
  block-size: 58px;
  margin-block-end: 5px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--teal-soft);
  color: var(--teal-ink);
  font-size: 29px;
}
.empty p {
  margin: 0;
  color: var(--ink-2);
}
.history-list {
  display: grid;
  gap: 10px;
  padding-block-end: 12px;
}
.history {
  padding: 14px;
  display: flex;
  align-items: center;
  gap: 11px;
  box-shadow: var(--sh-sm);
}
.history__icon {
  inline-size: 40px;
  block-size: 40px;
  flex: 0 0 auto;
  border-radius: 13px;
  display: grid;
  place-items: center;
  font-size: 21px;
}
.history__icon--pending {
  background: var(--sun-soft);
  color: #9a6a0a;
}
.history__icon--paid {
  background: var(--teal-soft);
  color: var(--teal-ink);
}
.history__icon--failed {
  background: #fde6e6;
  color: var(--danger);
}
.history__icon--refunded {
  background: var(--sky-soft);
  color: #287ba8;
}
.history__copy {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 3px;
}
.history__copy strong {
  font: 800 14px var(--ff-display);
}
.history__copy small {
  color: var(--ink-2);
  font-size: 11.5px;
  font-weight: 600;
}
.history__end {
  display: grid;
  justify-items: end;
  gap: 4px;
}
.history__end > strong {
  font: 800 14px var(--ff-display);
}
.history__status {
  padding: 3px 8px;
  border-radius: var(--r-pill);
  font-size: 10.5px;
  font-weight: 800;
}
.history__status--pending {
  background: var(--sun-soft);
  color: #8a6212;
}
.history__status--paid {
  background: var(--teal-soft);
  color: var(--teal-ink);
}
.history__status--failed {
  background: #fde6e6;
  color: var(--danger);
}
.history__status--refunded {
  background: var(--sky-soft);
  color: #287ba8;
}
</style>
