<script setup lang="ts">
import { computed } from 'vue';
import { session } from '../../../runtime';

/**
 * The clinic's day, as far as it is known.
 *
 * Today it shows the clinic's own date and policy, which is genuinely useful —
 * "today" here is Africa/Cairo, computed by the server, not the browser's idea
 * of it. Appointments and the live queue land on this page as they are built.
 */

const identity = computed(() => session.state.identity);

const todayLabel = computed(() => {
  const clinic = identity.value?.clinic;
  if (clinic === undefined) return '';
  // The clinic's own date, formatted in its own calendar and language.
  return new Intl.DateTimeFormat('ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: clinic.timezone,
  }).format(new Date(`${clinic.today}T12:00:00Z`));
});
</script>

<template>
  <div
    v-if="identity"
    class="c-stack"
  >
    <header>
      <h1 class="c-title">
        اليوم
      </h1>
      <p class="c-muted c-numerals">
        {{ todayLabel }}
      </p>
    </header>

    <section class="c-card c-stack">
      <h2 class="overview__heading">
        إعدادات العيادة
      </h2>
      <dl class="overview__facts c-numerals">
        <div>
          <dt class="c-field__label">
            المنطقة الزمنية
          </dt>
          <dd>{{ identity.clinic.timezone }}</dd>
        </div>
        <div>
          <dt class="c-field__label">
            مهلة الحضور
          </dt>
          <dd>{{ identity.clinic.gracePeriodMinutes }} دقيقة</dd>
        </div>
        <div>
          <dt class="c-field__label">
            حجوزات الأهل
          </dt>
          <dd>
            {{
              identity.clinic.autoConfirmParentBookings
                ? 'تُؤكَّد تلقائياً'
                : 'تحتاج موافقة العيادة'
            }}
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.overview__heading {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
}

.overview__facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--c-space);
  margin: 0;
}

.overview__facts dd {
  margin: 0;
  font-weight: 600;
}
</style>
