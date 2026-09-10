<script setup lang="ts">
defineProps<{ collected: number; pending: number; refunded: number }>();
const money = (v: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP' }).format(
    v / 100,
  );
</script>
<template>
  <section
    class="payment-kpis"
    aria-label="ملخص المدفوعات"
  >
    <article class="dcard dcard--pad">
      <span class="dmuted">تم التحصيل</span><strong>{{ money(collected) }}</strong>
    </article>
    <article class="dcard dcard--pad">
      <span class="dmuted">بانتظار المراجعة</span><strong>{{ money(pending) }}</strong>
    </article>
    <article class="dcard dcard--pad">
      <span class="dmuted">مسترد</span><strong>{{ money(refunded) }}</strong>
    </article>
  </section>
</template>
<style scoped>
.payment-kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.payment-kpis article {
  display: grid;
  gap: 5px;
}
.payment-kpis strong {
  font-size: 22px;
  color: var(--coral-ink);
}
@media (max-width: 700px) {
  .payment-kpis {
    grid-template-columns: 1fr;
  }
}
</style>
