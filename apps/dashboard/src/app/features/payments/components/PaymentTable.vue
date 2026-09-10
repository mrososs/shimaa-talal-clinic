<script setup lang="ts">
import { ClinicMemberRole, type ClinicPayment } from '@clinic/contracts';
defineProps<{
  items: readonly ClinicPayment[];
  working: string | null;
  role: ClinicMemberRole;
}>();
const emit = defineEmits<{
  approve: [string];
  reject: [string];
  refund: [string];
  receipt: [string];
}>();
const money = (v: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP' }).format(
    v / 100,
  );
const status: Record<string, string> = {
  pending: 'بانتظار المراجعة',
  paid: 'مدفوع',
  failed: 'مرفوض',
  refunded: 'مسترد',
};
</script>
<template>
  <div class="dcard payment-table">
    <div
      v-if="!items.length"
      class="dempty"
    >
      لا توجد مدفوعات في السجل بعد.
    </div>
    <div
      v-for="p in items"
      :key="p.id"
      class="payment-row"
    >
      <div>
        <strong>{{ p.childName }}</strong><small>{{ p.guardianName }} ·
          {{ p.method === 'cash' ? 'نقدي' : 'InstaPay' }}</small>
      </div>
      <strong>{{ money(p.amountMinor) }}</strong><span
        class="dbadge"
        :class="{
          'dbadge--warn': p.status === 'pending',
          'dbadge--ok': p.status === 'paid',
        }"
      >{{ status[p.status] }}</span>
      <div class="dactions">
        <button
          v-if="p.receiptFileName"
          class="dbtn dbtn--ghost"
          @click="emit('receipt', p.id)"
        >
          الإيصال
        </button><button
          v-if="p.status === 'pending'"
          class="dbtn dbtn--primary"
          :disabled="working === p.id"
          @click="emit('approve', p.id)"
        >
          اعتماد
        </button><button
          v-if="p.status === 'pending'"
          class="dbtn dbtn--ghost"
          :disabled="working === p.id"
          @click="emit('reject', p.id)"
        >
          رفض
        </button><button
          v-if="p.status === 'paid' && role !== ClinicMemberRole.Reception"
          class="dbtn dbtn--ghost"
          :disabled="working === p.id"
          @click="emit('refund', p.id)"
        >
          استرداد
        </button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.payment-table {
  overflow: hidden;
}
.payment-row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 140px 140px auto;
  gap: 14px;
  align-items: center;
  padding: 15px 18px;
  border-bottom: 1px solid var(--line);
}
.payment-row:last-child {
  border-bottom: 0;
}
.payment-row > div:first-child {
  display: grid;
}
.payment-row small {
  color: var(--muted);
}
@media (max-width: 900px) {
  .payment-row {
    grid-template-columns: 1fr auto;
  }
  .payment-row .dactions {
    grid-column: 1/-1;
  }
}
</style>
