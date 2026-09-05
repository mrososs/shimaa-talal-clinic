<script setup lang="ts">
import { computed, toRef } from 'vue';
import { IonIcon } from '@ionic/vue';
import { timeOutline } from 'ionicons/icons';
import { arabicDigits } from '../../../shared/numerals';
import { useCountdown } from '../composables/useCountdown';

/**
 * The one ticking clock in this app.
 *
 * `graceExpiresAt` is a deadline the clinic set when it called this patient, so
 * counting down to it reports something real. Everything else a parent is told
 * about time is a range, because everything else is a guess.
 *
 * Reaching zero changes nothing on its own. Nobody is marked missed by a timer
 * — staff do that, and until they do the turn is still theirs. `expire` asks
 * the server what actually happened instead of deciding here.
 */

const props = defineProps<{ expiresAt: string | null; graceMinutes?: number }>();
const emit = defineEmits<{ expire: [] }>();

const { label, secondsLeft, expired } = useCountdown(
  toRef(props, 'expiresAt'),
  () => emit('expire'),
);

/** Under two minutes: the nudge the design shows before the deadline. */
const urgent = computed(
  () => secondsLeft.value !== null && secondsLeft.value <= 120,
);
</script>

<template>
  <div
    class="grace"
    :class="{ 'grace--urgent': urgent, 'grace--gone': expired }"
  >
    <span class="grace__ico">
      <ion-icon :icon="timeOutline" />
    </span>

    <template v-if="expired">
      <div>
        <p class="grace__label">
          انتهت مهلة الحضور
        </p>
        <p class="grace__note">
          توجّهي إلى الاستقبال — سيؤكّدون وضعك في الطابور.
        </p>
      </div>
    </template>

    <template v-else>
      <div>
        <p class="grace__label">
          <template v-if="graceMinutes">
            لديك {{ arabicDigits(graceMinutes) }} دقائق للحضور
          </template>
          <template v-else>
            وقت الحضور المتبقّي
          </template>
        </p>
        <p class="grace__clock">
          {{ arabicDigits(label ?? '—') }}
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.grace {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--r-pill);
  background: rgb(255 255 255 / 22%);
  color: #fff;
}

.grace--urgent {
  background: rgb(255 255 255 / 34%);
}

.grace--gone {
  background: rgb(255 255 255 / 18%);
}

.grace__ico {
  display: grid;
  place-items: center;
  font-size: 20px;
  flex-shrink: 0;
}

.grace__label {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  opacity: 0.9;
}

.grace__note {
  margin: 3px 0 0;
  font-size: 12.5px;
  line-height: 1.6;
  opacity: 0.9;
}

.grace__clock {
  margin: 2px 0 0;
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 24px;
  font-variant-numeric: tabular-nums;
}
</style>
