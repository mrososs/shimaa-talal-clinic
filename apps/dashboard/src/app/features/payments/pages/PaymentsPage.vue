<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type {
  AppointmentListItem,
  RegisterPaymentInput,
} from '@clinic/contracts';
import { clinicApi, paymentsApi, session } from '../../../runtime';
import PaymentKpis from '../components/PaymentKpis.vue';
import PaymentTable from '../components/PaymentTable.vue';
import RegisterPaymentDialog from '../components/RegisterPaymentDialog.vue';
import { usePayments } from '../composables/usePayments';
const store = usePayments(),
  appointments = ref<AppointmentListItem[]>([]),
  role = computed(() => session.state.identity!.member.role);
onMounted(async () => {
  await Promise.all([
    store.load(),
    clinicApi
      .appointments(session.state.identity?.clinic.today)
      .then((v) => (appointments.value = v))
      .catch(() => undefined),
  ]);
});
function receipt(id: string) {
  void paymentsApi
    .receipt(id)
    .then((v) => window.open(v.url, '_blank', 'noopener,noreferrer'));
}
</script>
<template>
  <div class="dstack">
    <div class="page-actions">
      <p class="dmuted">
        سجل موحد للنقدي وإيصالات InstaPay، مع قرار واضح لكل إيصال.
      </p>
      <RegisterPaymentDialog
        :appointments="appointments"
        :working="store.working.value === 'create'"
        @cash="(v: RegisterPaymentInput) => store.cash(v)"
        @instapay="(v: RegisterPaymentInput, f: File) => store.instapay(v, f)"
      />
    </div>
    <p
      v-if="store.failure.value"
      class="dnotice dnotice--error"
      role="alert"
    >
      {{ store.failure.value }}
    </p>
    <PaymentKpis
      v-if="store.data.value"
      :collected="store.data.value.totals.collectedMinor"
      :pending="store.data.value.totals.pendingMinor"
      :refunded="store.data.value.totals.refundedMinor"
    />
    <div
      v-if="store.loading.value"
      class="dcard dcard--pad"
    >
      جارٍ تحميل المدفوعات…
    </div>
    <PaymentTable
      v-else
      :items="store.data.value?.items ?? []"
      :working="store.working.value"
      :role="role"
      @approve="store.approve"
      @reject="store.reject"
      @refund="store.refund"
      @receipt="receipt"
    />
  </div>
</template>
<style scoped>
.page-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
</style>
