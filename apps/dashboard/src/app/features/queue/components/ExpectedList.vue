<script setup lang="ts">
import { computed } from 'vue';
import type { AppointmentListItem } from '@clinic/contracts';
import { arabicDigits } from '../../../shared/numerals';
import { ageLabel, windowLabel } from '../../../shared/format';

/**
 * The families expected, who are not here yet.
 *
 * A separate list from the queue on purpose. An appointment is not a place in
 * the line — nobody holds a turn until they walk in — and merging the two would
 * put a patient on the board that "call next" could then announce to an empty
 * waiting room.
 *
 * "Late" is derived from the clock, never stored: the arrival window has closed
 * and no queue entry exists. It is a prompt to phone the family, not a state
 * anyone sets.
 */

const props = defineProps<{
  items: readonly AppointmentListItem[];
  timezone: string;
  /** Checking a patient in is the desk's job, not the doctor's. */
  canCheckIn: boolean;
  working: string | null;
}>();

const emit = defineEmits<{
  checkIn: [appointment: AppointmentListItem];
}>();

const busy = computed(() => props.working !== null);
const late = computed(() => props.items.filter((item) => item.isLate).length);
</script>

<template>
  <section class="dcard">
    <header class="dcard__head">
      <h2 class="dcard__title">بانتظار الوصول</h2>
      <div class="drow">
        <span v-if="late > 0" class="dpill dpill--warn"
          >متأخر {{ arabicDigits(late) }}</span
        >
        <span class="dpill">{{ arabicDigits(items.length) }}</span>
      </div>
    </header>

    <p v-if="items.length === 0" class="dcard--pad dmuted centre">
      وصل كل من لديه موعد.
    </p>

    <div v-else class="dtable">
      <div
        v-for="item in items"
        :key="item.id"
        class="dtable__row row"
        :data-appointment-id="item.id"
      >
        <!-- Stacked rather than columned: this list shares the row with the
             queue itself, so it is often half the width and four columns of
             names and times do not fit in it. -->
        <div class="row__who">
          <span class="row__when">
            <span class="row__window">
              {{ windowLabel(item.windowStart, item.windowEnd, timezone) }}
            </span>
            <span v-if="item.isLate" class="dpill dpill--warn">تأخّر</span>
          </span>
          <strong>{{ item.child.fullName }}</strong>
          <span class="dmuted">
            {{ ageLabel(item.child.dateOfBirth) ?? '—' }} ·
            {{ item.guardian.fullName }}
          </span>
        </div>

        <button
          v-if="canCheckIn"
          class="dbtn dbtn--teal dbtn--sm"
          :disabled="busy"
          @click="emit('checkIn', item)"
        >
          تسجيل الوصول
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.centre {
  text-align: center;
}

.row {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.row__when {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.row__window {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 14px;
}

.row__who {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.row__who > span:last-child {
  font-size: 12.5px;
}
</style>
