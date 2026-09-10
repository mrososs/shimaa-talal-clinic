<script setup lang="ts">
import { RouterLink } from 'vue-router';
import type { AppointmentListItem } from '@clinic/contracts';

defineProps<{ requests: readonly AppointmentListItem[] }>();
</script>

<template>
  <section class="dcard requests">
    <header class="dcard__head">
      <div>
        <h2 class="dcard__title">
          طلبات حجز جديدة
        </h2>
        <p class="requests__hint">
          تحتاج قرار العيادة
        </p>
      </div>
      <RouterLink
        class="dbtn dbtn--ghost dbtn--sm"
        :to="{ name: 'appointments' }"
      >
        عرض الكل
      </RouterLink>
    </header>
    <div
      v-if="requests.length"
      class="requests__list"
    >
      <article
        v-for="request in requests.slice(0, 4)"
        :key="request.id"
        class="requests__row"
      >
        <div
          class="requests__avatar"
          aria-hidden="true"
        >
          {{ request.child.fullName.trim().at(0) ?? 'ط' }}
        </div>
        <div class="requests__identity">
          <strong>{{ request.child.fullName }}</strong>
          <p>ولي الأمر: {{ request.guardian.fullName }}</p>
        </div>
        <span class="dpill dpill--warn">بانتظار الموافقة</span>
      </article>
    </div>
    <p
      v-else
      class="requests__empty"
    >
      لا توجد طلبات تحتاج مراجعة.
    </p>
  </section>
</template>

<style scoped>
.requests__hint,
.requests__identity p {
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 600;
}
.requests__list {
  padding-inline: 20px;
}
.requests__row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding-block: 13px;
  border-bottom: 1px solid var(--line);
}
.requests__row:last-child {
  border-bottom: 0;
}
.requests__avatar {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  color: var(--coral-ink);
  background: var(--coral-soft);
  font-family: var(--ff-display);
  font-weight: 800;
}
.requests__identity {
  min-width: 0;
}
.requests__identity strong,
.requests__identity p {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.requests__empty {
  padding: 28px 20px;
  color: var(--ink-2);
  text-align: center;
}

@media (max-width: 560px) {
  .requests__row {
    grid-template-columns: 42px 1fr;
  }
  .requests__row .dpill {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
