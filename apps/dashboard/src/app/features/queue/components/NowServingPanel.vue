<script setup lang="ts">
import { computed } from 'vue';
import type { QueueBoardEntry } from '@clinic/contracts';
import { arabicDigits } from '../../../shared/numerals';
import { ageLabel } from '../../../shared/format';

/**
 * Who is in the room, and who has just been called.
 *
 * The one panel a doctor looks at between patients, so it holds exactly what
 * she needs to start: the name, the age, why they came, and the two buttons
 * that move the visit along.
 *
 * "Next please" is one gesture and one request. It completes whoever is in the
 * room and calls the next name in a single transaction — splitting it would
 * leave a moment where nobody is being served and a second receptionist could
 * call somebody else.
 */

const props = defineProps<{
  inService: QueueBoardEntry | null;
  called: QueueBoardEntry | null;
  waitingCount: number;
  running: boolean;
  working: string | null;
  /** Reception may skip a patient; the doctor calls, starts and completes. */
  canMiss: boolean;
}>();

const emit = defineEmits<{
  callNext: [];
  start: [entryId: string];
  complete: [entryId: string];
  miss: [entry: QueueBoardEntry];
}>();

const busy = computed(() => props.working !== null);

/** Whether the promised grace has run out, recomputed from the timestamp. */
const graceLapsed = computed(() => {
  const at = props.called?.graceExpiresAt;
  return at !== null && at !== undefined && Date.parse(at) <= Date.now();
});
</script>

<template>
  <section class="dcard dcard--pad now">
    <header class="now__head">
      <h2 class="dcard__title">
        الآن
      </h2>
      <button
        class="dbtn dbtn--primary"
        :disabled="busy || !running || waitingCount === 0"
        @click="emit('callNext')"
      >
        نداء التالي
      </button>
    </header>

    <!-- In the room. -->
    <div
      v-if="inService"
      class="now__patient now__patient--serving"
    >
      <span class="now__ticket">{{ arabicDigits(inService.ticketNumber) }}</span>
      <div class="now__who">
        <strong>{{ inService.child.fullName }}</strong>
        <span class="dmuted">
          {{ ageLabel(inService.child.dateOfBirth) ?? '—' }}
          <template v-if="inService.visitReason">
            · {{ inService.visitReason }}
          </template>
        </span>
      </div>
      <span class="dpill dpill--ok">في الكشف</span>
      <button
        class="dbtn dbtn--teal dbtn--sm"
        :disabled="busy"
        @click="emit('complete', inService.id)"
      >
        إنهاء الكشف
      </button>
    </div>

    <!-- Called, and we are waiting for them to walk in. -->
    <div
      v-if="called"
      class="now__patient"
    >
      <span class="now__ticket">{{ arabicDigits(called.ticketNumber) }}</span>
      <div class="now__who">
        <strong>{{ called.child.fullName }}</strong>
        <span class="dmuted">
          {{ ageLabel(called.child.dateOfBirth) ?? '—' }}
          <template v-if="called.guardian"> · {{ called.guardian.fullName }}</template>
        </span>
      </div>
      <span
        class="dpill"
        :class="graceLapsed ? 'dpill--danger' : 'dpill--warn'"
      >
        {{ graceLapsed ? 'انتهت المهلة' : 'تم النداء' }}
      </span>
      <div class="now__actions">
        <button
          class="dbtn dbtn--teal dbtn--sm"
          :disabled="busy"
          @click="emit('start', called.id)"
        >
          بدء الكشف
        </button>
        <button
          v-if="canMiss"
          class="dbtn dbtn--ghost dbtn--sm"
          :disabled="busy"
          @click="emit('miss', called)"
        >
          لم يحضر
        </button>
      </div>
    </div>

    <p
      v-if="!inService && !called"
      class="dmuted now__empty"
    >
      <template v-if="!running">
        الطابور غير مفعّل الآن.
      </template>
      <template v-else-if="waitingCount === 0">
        لا يوجد مرضى في الانتظار.
      </template>
      <template v-else>
        لم يبدأ النداء بعد — {{ arabicDigits(waitingCount) }} في الانتظار.
      </template>
    </p>
  </section>
</template>

<style scoped>
.now {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.now__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.now__patient {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-radius: var(--r-md);
  background: var(--surface-2);
  border: 1.5px solid var(--line);
  flex-wrap: wrap;
}

.now__patient--serving {
  background: var(--teal-soft);
  border-color: transparent;
}

.now__ticket {
  font-family: var(--ff-display);
  font-size: 26px;
  font-weight: 800;
  min-width: 52px;
  text-align: center;
}

.now__who {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 140px;
}

.now__who span {
  font-size: 13px;
}

.now__actions {
  display: flex;
  gap: 6px;
}

.now__empty {
  margin: 0;
  padding: 18px 0;
  text-align: center;
}
</style>
