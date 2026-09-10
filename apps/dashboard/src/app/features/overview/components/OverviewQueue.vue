<script setup lang="ts">
import { RouterLink } from 'vue-router';
import type { QueueBoardEntry } from '@clinic/contracts';
import { arabicDigits } from '../../../shared/numerals';

defineProps<{
  nowServing: QueueBoardEntry | null;
  nextWaiting: readonly QueueBoardEntry[];
}>();
</script>

<template>
  <section class="dcard overview-queue">
    <header class="dcard__head">
      <div>
        <h2 class="dcard__title">
          الطابور المباشر
        </h2>
        <p class="overview-queue__hint">
          صورة مختصرة من ترتيب الخادم
        </p>
      </div>
      <RouterLink
        class="dbtn dbtn--soft dbtn--sm"
        :to="{ name: 'queue' }"
      >
        إدارة الطابور
      </RouterLink>
    </header>

    <div class="overview-queue__body">
      <article
        v-if="nowServing"
        class="overview-queue__current"
      >
        <span class="dpill dpill--ok">داخل الكشف</span>
        <div>
          <strong>{{ nowServing.child.fullName }}</strong>
          <p>رقم {{ arabicDigits(nowServing.ticketNumber) }}</p>
        </div>
      </article>
      <p
        v-else
        class="overview-queue__empty"
      >
        لا يوجد مريض داخل الكشف الآن.
      </p>

      <div
        v-if="nextWaiting.length"
        class="overview-queue__waiting"
      >
        <p class="overview-queue__label">
          التالي في الانتظار
        </p>
        <div
          v-for="entry in nextWaiting"
          :key="entry.id"
          class="overview-queue__row"
        >
          <span class="overview-queue__ticket">
            {{ arabicDigits(entry.ticketNumber) }}
          </span>
          <span>{{ entry.child.fullName }}</span>
          <span
            v-if="entry.isEmergency"
            class="dpill dpill--danger"
          >عاجل</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.overview-queue__hint,
.overview-queue__current p {
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 600;
}

.overview-queue__body {
  padding: 18px 20px 20px;
}

.overview-queue__current {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-radius: 16px;
  background: var(--teal-soft);
}

.overview-queue__empty {
  padding: 18px;
  border-radius: 16px;
  color: var(--ink-2);
  background: var(--surface-2);
}

.overview-queue__waiting {
  margin-top: 18px;
}
.overview-queue__label {
  margin-bottom: 8px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}
.overview-queue__row {
  display: grid;
  grid-template-columns: 38px 1fr auto;
  align-items: center;
  gap: 10px;
  padding-block: 9px;
  border-bottom: 1px solid var(--line);
  font-weight: 700;
}
.overview-queue__row:last-child {
  border-bottom: 0;
}
.overview-queue__ticket {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 11px;
  color: var(--coral-ink);
  background: var(--coral-soft);
  font-weight: 800;
}
</style>
