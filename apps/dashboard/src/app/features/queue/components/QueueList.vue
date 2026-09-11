<script setup lang="ts">
import { computed } from 'vue';
import { QueueStatus, type QueueBoardEntry } from '@clinic/contracts';
import { arabicDigits } from '../../../shared/numerals';
import { ageLabel } from '../../../shared/format';

/**
 * The line, in the order the server says people will be served.
 *
 * Rendered exactly as it arrives. Nothing here sorts: an emergency is served
 * ahead of the queue without anyone's number changing, so ordering by ticket
 * number would put the board and the clinic into disagreement.
 *
 * Every action is its own button, and a button only exists when that move is
 * legal from where the patient is now. A status dropdown would let staff pick a
 * transition the server refuses, and then the screen has to explain a refusal
 * it invited.
 */

const props = defineProps<{
  entries: readonly QueueBoardEntry[];
  /** Reception and admin only: removing and reordering are desk decisions. */
  canManage: boolean;
  /** The narrowed doctor view advances with Call Next, not an arbitrary row. */
  canCall?: boolean;
  /** Capturing vitals is allowed for all active clinic staff. */
  canRecordMeasurements?: boolean;
  working: string | null;
}>();

const emit = defineEmits<{
  call: [entry: QueueBoardEntry];
  emergency: [entry: QueueBoardEntry];
  clearEmergency: [entry: QueueBoardEntry];
  remove: [entry: QueueBoardEntry];
  move: [entry: QueueBoardEntry, direction: -1 | 1];
  recordMeasurements: [entry: QueueBoardEntry];
  share: [entry: QueueBoardEntry];
}>();

const busy = computed(() => props.working !== null);
</script>

<template>
  <section class="dcard">
    <header class="dcard__head">
      <h2 class="dcard__title">في الانتظار</h2>
      <span class="dpill">{{ arabicDigits(entries.length) }}</span>
    </header>

    <p v-if="entries.length === 0" class="dcard--pad dmuted centre">
      لا أحد في الانتظار.
    </p>

    <div v-else class="dtable">
      <div
        v-for="(entry, index) in entries"
        :key="entry.id"
        class="dtable__row row"
        :data-entry-id="entry.id"
        :data-appointment-id="entry.appointmentId ?? undefined"
        :class="{ 'row--urgent': entry.isEmergency }"
      >
        <span class="row__ticket">
          {{ arabicDigits(entry.ticketNumber) }}
        </span>

        <div class="row__who">
          <strong>{{ entry.child.fullName }}</strong>
          <span class="dmuted">
            {{ ageLabel(entry.child.dateOfBirth) ?? '—' }}
            <template v-if="entry.guardian">
              · {{ entry.guardian.fullName }}
            </template>
          </span>
        </div>

        <div class="row__tags">
          <span
            v-if="entry.isEmergency"
            class="dpill dpill--danger"
            :title="entry.emergencyReason ?? undefined"
            >عاجل</span
          >
          <span v-if="entry.source === 'walk_in'" class="dpill">بدون موعد</span>
          <span v-if="entry.deferCount > 0" class="dpill"
            >تخطّى {{ arabicDigits(entry.deferCount) }}</span
          >
        </div>

        <div class="row__actions">
          <button
            v-if="canRecordMeasurements"
            class="dbtn dbtn--ghost dbtn--sm"
            type="button"
            :disabled="busy"
            @click="emit('recordMeasurements', entry)"
          >
            تسجيل القياسات
          </button>
          <button
            v-if="canCall !== false"
            class="dbtn dbtn--soft dbtn--sm"
            :disabled="busy"
            @click="emit('call', entry)"
          >
            نداء
          </button>

          <template v-if="canManage">
            <button
              class="dbtn dbtn--ghost dbtn--sm"
              type="button"
              :disabled="busy"
              @click="emit('share', entry)"
            >
              نسخ رابط المتابعة
            </button>
            <button
              v-if="entry.isEmergency"
              class="dbtn dbtn--ghost dbtn--sm"
              :disabled="busy"
              @click="emit('clearEmergency', entry)"
            >
              إلغاء العاجل
            </button>
            <button
              v-else
              class="dbtn dbtn--ghost dbtn--sm"
              :disabled="busy"
              @click="emit('emergency', entry)"
            >
              عاجل
            </button>

            <button
              class="diconbtn"
              type="button"
              :disabled="busy || index === 0"
              aria-label="تقديم"
              @click="emit('move', entry, -1)"
            >
              ↑
            </button>
            <button
              class="diconbtn"
              type="button"
              :disabled="busy || index === entries.length - 1"
              aria-label="تأخير"
              @click="emit('move', entry, 1)"
            >
              ↓
            </button>
            <button
              class="dbtn dbtn--ghost dbtn--sm"
              :disabled="busy"
              @click="emit('remove', entry)"
            >
              إزالة
            </button>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.centre {
  text-align: center;
}

.row {
  grid-template-columns: 62px minmax(160px, 1fr) auto auto;
  align-items: center;
}

.row--urgent {
  background: #fdf1f1;
}

.row__ticket {
  font-family: var(--ff-display);
  font-size: 20px;
  font-weight: 800;
  text-align: center;
}

.row__who {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.row__who span {
  font-size: 12.5px;
}

.row__tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.row__actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  flex-wrap: wrap;
}

@media (max-width: 980px) {
  .row {
    grid-template-columns: 52px 1fr;
    row-gap: 8px;
  }

  .row__tags,
  .row__actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }
}
</style>
