<script setup lang="ts">
import { computed } from 'vue';
import { arabicDigits } from '../../../shared/numerals';
import { session } from '../../../runtime';

/**
 * The clinic's day, as far as it is known.
 *
 * Today it shows the clinic's own date and policy, which is genuinely useful —
 * "today" here is Africa/Cairo, computed by the server, not the browser's idea
 * of it. Appointments and the live queue land on this page as they are built.
 */

const identity = computed(() => session.state.identity);
</script>

<template>
  <div
    v-if="identity"
    class="dstack"
  >
    <!-- The title and the date belong to the shell's top bar; a page that drew
         its own would render them twice. -->
    <section class="dcard dcard--pad dstack">
      <h2 class="overview__heading">
        إعدادات العيادة
      </h2>
      <dl class="overview__facts">
        <div>
          <dt class="dfield__label">
            المنطقة الزمنية
          </dt>
          <dd>{{ identity.clinic.timezone }}</dd>
        </div>
        <div>
          <dt class="dfield__label">
            مهلة الحضور
          </dt>
          <dd>{{ arabicDigits(identity.clinic.gracePeriodMinutes) }} دقيقة</dd>
        </div>
        <div>
          <dt class="dfield__label">
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
  gap: 16px;
  margin: 0;
}

.overview__facts dd {
  margin: 0;
  font-weight: 600;
}
</style>
