<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  onIonViewDidLeave,
  onIonViewWillEnter,
  type RefresherCustomEvent,
} from '@ionic/vue';
import ScreenShell from '../../../shared/components/ScreenShell.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { shortDayLabel } from '../../../shared/format';
import PaymentAppointmentList from '../components/PaymentAppointmentList.vue';
import PaymentMethodPanel from '../components/PaymentMethodPanel.vue';
import { useParentPayments } from '../composables/useParentPayments';

const route = useRoute();
const payments = useParentPayments(() => {
  const value = route.query['appointmentId'];
  return typeof value === 'string' ? value : null;
});

const history = computed(() => payments.view.value.items);

const STATUS: Record<string, string> = {
  pending: 'قيد المراجعة',
  paid: 'تم الدفع',
  failed: 'مرفوض',
  refunded: 'تم الاسترداد',
};

const METHOD: Record<string, string> = {
  cash: 'الدفع في العيادة',
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
    subtitle="اختاري الموعد والطريقة المناسبة"
    :back-to="{ name: 'home' }"
  >
    <template #above>
      <ion-refresher slot="fixed" @ion-refresh="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>
    </template>

    <div class="stack">
      <form-notice :message="payments.failure.value" />
      <form-notice
        v-if="payments.success.value"
        tone="success"
        :message="payments.success.value"
      />

      <div v-if="payments.loading.value" class="card loading">
        <ion-spinner name="crescent" />
      </div>

      <template v-else>
        <template v-if="payments.view.value.payableAppointments.length > 0">
          <payment-appointment-list
            :appointments="payments.view.value.payableAppointments"
            :selected-id="payments.selectedId.value"
            @select="payments.select"
          />
          <payment-method-panel
            v-if="payments.selected.value"
            :appointment="payments.selected.value"
            :working="payments.working.value"
            @cash="payments.registerCash"
            @instapay="payments.registerInstapay"
          />
        </template>

        <section v-else class="card empty">
          <strong>لا توجد مواعيد تحتاج إلى دفع الآن</strong>
          <p>ستظهر هنا المواعيد المؤهلة بمجرد حجزها.</p>
        </section>

        <section v-if="history.length > 0" class="stack stack--tight">
          <h2 class="section-title">عمليات الدفع</h2>
          <article v-for="payment in history" :key="payment.id" class="card history">
            <div>
              <strong>{{ METHOD[payment.method] ?? payment.method }}</strong>
              <small>{{ shortDayLabel(payment.createdAt) }}</small>
            </div>
            <div class="history__end">
              <strong>{{ money(payment.amountMinor, payment.currency) }}</strong>
              <span class="chip">{{ STATUS[payment.status] ?? payment.status }}</span>
            </div>
          </article>
        </section>
      </template>
    </div>
  </screen-shell>
</template>

<style scoped>
.loading {
  min-height: 160px;
  display: grid;
  place-items: center;
}

.empty {
  text-align: center;
  padding-block: 28px;
}

.empty p {
  color: var(--ink-2);
  margin: 6px 0 0;
}

.history {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.history > div {
  display: grid;
  gap: 4px;
}

.history small {
  color: var(--ink-2);
}

.history__end {
  justify-items: end;
}
</style>
