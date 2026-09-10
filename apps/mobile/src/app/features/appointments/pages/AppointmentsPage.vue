<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonButton,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  onIonViewDidLeave,
  onIonViewWillEnter,
  type RefresherCustomEvent,
} from '@ionic/vue';
import { chevronBackOutline } from 'ionicons/icons';
import ScreenShell from '../../../shared/components/ScreenShell.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { shortDayLabel, windowLabel } from '../../../shared/format';
import { session } from '../../../runtime';
import { useAppointments } from '../composables/useAppointments';

/**
 * Every visit this family has, split into what is ahead and what has been.
 *
 * Two lists rather than one with a filter, because they answer different
 * questions: "when are we going" and "when did we last go".
 */

const router = useRouter();
const state = session.state;
const appointments = useAppointments();

const timezone = computed(() => state.identity?.clinic.timezone);
const childNameById = computed(
  () =>
    new Map(
      (state.identity?.children ?? []).map((child) => [
        child.id,
        child.fullName,
      ]),
    ),
);

const STATUS: Record<string, { label: string; tone: string }> = {
  requested: { label: 'قيد المراجعة', tone: 'warn' },
  confirmed: { label: 'مؤكّد', tone: 'ok' },
  checked_in: { label: 'في العيادة', tone: 'ok' },
  completed: { label: 'تم', tone: 'muted' },
  cancelled: { label: 'ملغي', tone: 'danger' },
  no_show: { label: 'لم يحضر', tone: 'danger' },
};

async function refresh(event?: RefresherCustomEvent): Promise<void> {
  await appointments.refresh();
  await event?.target.complete();
}

onIonViewWillEnter(() => void appointments.open());
onIonViewDidLeave(() => appointments.close());
</script>

<template>
  <screen-shell title="المواعيد">
    <template #above>
      <ion-refresher
        slot="fixed"
        @ion-refresh="refresh($event)"
      >
        <ion-refresher-content />
      </ion-refresher>
    </template>

    <div class="stack">
      <div class="tabs">
        <button
          type="button"
          :class="{ on: appointments.scope.value === 'upcoming' }"
          @click="appointments.selectScope('upcoming')"
        >
          القادمة
        </button>
        <button
          type="button"
          :class="{ on: appointments.scope.value === 'past' }"
          @click="appointments.selectScope('past')"
        >
          السابقة
        </button>
      </div>

      <form-notice :message="appointments.failure.value" />

      <div
        v-if="appointments.loading.value"
        class="card card--centre"
      >
        <ion-spinner name="crescent" />
      </div>

      <div
        v-else-if="appointments.empty.value"
        class="card empty"
      >
        <p class="subtitle">
          {{
            appointments.scope.value === 'upcoming'
              ? 'لا توجد مواعيد قادمة.'
              : 'لا توجد زيارات سابقة بعد.'
          }}
        </p>
        <ion-button
          v-if="appointments.scope.value === 'upcoming'"
          expand="block"
          @click="router.push({ name: 'booking' })"
        >
          حجز موعد
        </ion-button>
      </div>

      <template v-else>
        <button
          v-for="appointment in appointments.items.value"
          :key="appointment.id"
          type="button"
          class="card visit"
          @click="
            router.push({
              name: 'appointment-detail',
              params: { appointmentId: appointment.id },
            })
          "
        >
          <div class="visit__date">
            {{ shortDayLabel(appointment.windowStart, timezone) }}
          </div>
          <div class="visit__text">
            <p class="visit__child">
              {{ childNameById.get(appointment.childId) ?? 'موعد' }}
            </p>
            <p class="visit__window">
              {{
                windowLabel(
                  appointment.windowStart,
                  appointment.windowEnd,
                  timezone,
                )
              }}
            </p>
          </div>
          <span
            class="chip"
            :class="`chip--${STATUS[appointment.status]?.tone ?? 'muted'}`"
          >
            {{ STATUS[appointment.status]?.label ?? appointment.status }}
          </span>
          <ion-icon
            class="visit__chevron"
            :icon="chevronBackOutline"
          />
        </button>
      </template>
    </div>
  </screen-shell>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 6px;
  background: var(--surface-2);
  padding: 5px;
  border-radius: var(--r-sm);
  border: 1.5px solid var(--line);
}

.tabs button {
  flex: 1;
  border: none;
  background: none;
  cursor: pointer;
  padding: 9px 0;
  border-radius: 10px;
  font-family: var(--ff-body);
  font-weight: 800;
  font-size: 13.5px;
  color: var(--ink-2);
}

.tabs button.on {
  background: var(--surface);
  color: var(--coral-ink);
  box-shadow: var(--sh-sm);
}

.card--centre {
  display: grid;
  place-items: center;
  min-height: 120px;
}

.empty {
  text-align: center;
  padding-block: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.visit {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  border: none;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: start;
}

.visit__date {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 13px;
  color: var(--coral-ink);
  background: var(--coral-soft);
  border-radius: var(--r-sm);
  padding: 8px 10px;
  white-space: nowrap;
  flex-shrink: 0;
}

.visit__text {
  flex: 1;
  min-width: 0;
}

.visit__child {
  margin: 0;
  font-weight: 800;
}

.visit__window {
  margin: 3px 0 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-2);
}

.chip--ok {
  background: var(--teal-soft);
  color: var(--teal-ink);
  border-color: transparent;
}

.chip--warn {
  background: var(--sun-soft);
  color: #8a6212;
  border-color: transparent;
}

.chip--danger {
  background: #fde6e6;
  color: var(--danger);
  border-color: transparent;
}

.visit__chevron {
  color: var(--muted);
  font-size: 17px;
}
</style>
