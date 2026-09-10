<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonButton,
  IonIcon,
  IonSpinner,
  onIonViewWillEnter,
} from '@ionic/vue';
import { checkmarkCircle } from 'ionicons/icons';
import ScreenShell from '../../../shared/components/ScreenShell.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { dayLabel, remainingLabel, windowLabel } from '../../../shared/format';
import { session } from '../../../runtime';
import { useRescheduleAppointment } from '../composables/useRescheduleAppointment';

const route = useRoute();
const router = useRouter();
const form = useRescheduleAppointment(() =>
  String(route.params['appointmentId']),
);

const timezone = computed(() => session.state.identity?.clinic.timezone);
const childName = computed(
  () =>
    session.state.identity?.children.find(
      (child) => child.id === form.appointment.value?.childId,
    )?.fullName ?? 'الطفل',
);

async function submit(): Promise<void> {
  const appointment = await form.submit();
  if (appointment === null) return;
  await router.replace({
    name: 'appointment-detail',
    params: { appointmentId: appointment.id },
  });
}

onIonViewWillEnter(() => void form.load());
</script>

<template>
  <screen-shell
    title="تغيير الموعد"
    subtitle="اختاري فترة وصول جديدة"
    :back-to="{
      name: 'appointment-detail',
      params: { appointmentId: route.params['appointmentId'] },
    }"
  >
    <div
      v-if="form.loading.value"
      class="card reschedule-loading"
    >
      <ion-spinner name="crescent" />
    </div>

    <div
      v-else
      class="stack"
    >
      <section
        v-if="form.appointment.value"
        class="current-visit"
      >
        <p class="current-visit__label">
          الموعد الحالي لـ {{ childName }}
        </p>
        <strong>
          {{
            windowLabel(
              form.appointment.value.windowStart,
              form.appointment.value.windowEnd,
              timezone,
            )
          }}
        </strong>
      </section>

      <form-notice :message="form.failure.value" />

      <section class="stack stack--tight">
        <h2 class="section-title">
          اليوم الجديد
        </h2>
        <div class="reschedule-days">
          <button
            v-for="day in form.days.value"
            :key="day.date"
            type="button"
            class="chip reschedule-day"
            :class="{ 'chip--on': form.selectedDate.value === day.date }"
            @click="form.pickDay(day.date)"
          >
            {{ dayLabel(`${day.date}T12:00:00Z`, timezone) }}
          </button>
        </div>
      </section>

      <section
        v-if="form.selectedDate.value"
        class="stack stack--tight"
      >
        <h2 class="section-title">
          فترة الوصول الجديدة
        </h2>
        <div
          v-if="form.windowsForDay.value.length"
          class="reschedule-windows"
        >
          <button
            v-for="window in form.windowsForDay.value"
            :key="window.windowStart"
            type="button"
            class="card reschedule-window"
            :class="{
              'reschedule-window--on':
                form.selectedWindow.value?.windowStart === window.windowStart,
            }"
            @click="form.selectedWindow.value = window"
          >
            <span class="reschedule-window__time">
              {{ windowLabel(window.windowStart, window.windowEnd, timezone) }}
            </span>
            <span class="reschedule-window__left">
              {{ remainingLabel(window.remaining, window.capacity) }}
            </span>
            <ion-icon
              v-if="
                form.selectedWindow.value?.windowStart === window.windowStart
              "
              :icon="checkmarkCircle"
            />
          </button>
        </div>
        <p
          v-else
          class="card reschedule-empty"
        >
          لا توجد فترة بديلة متاحة في هذا اليوم.
        </p>
      </section>

      <ion-button
        expand="block"
        size="large"
        :disabled="!form.canSubmit.value"
        @click="submit"
      >
        <ion-spinner
          v-if="form.submitting.value"
          name="crescent"
        />
        <span v-else>تأكيد الموعد الجديد</span>
      </ion-button>
    </div>
  </screen-shell>
</template>

<style scoped>
.reschedule-loading {
  display: grid;
  min-block-size: 150px;
  place-items: center;
}

.current-visit {
  padding: 16px 18px;
  border-radius: var(--r-md);
  background: var(--sun-soft);
  color: #664813;
}

.current-visit__label {
  margin: 0 0 3px;
  font-size: 12.5px;
  font-weight: 700;
}

.reschedule-days {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-block-end: 3px;
  scrollbar-width: none;
}

.reschedule-days::-webkit-scrollbar {
  display: none;
}

.reschedule-day {
  flex-shrink: 0;
  min-block-size: 44px;
  font: inherit;
}

.reschedule-windows {
  display: grid;
  gap: 10px;
}

.reschedule-window {
  display: flex;
  align-items: center;
  gap: 10px;
  min-block-size: 64px;
  border: 1.5px solid transparent;
  color: inherit;
  font: inherit;
  text-align: start;
}

.reschedule-window--on {
  border-color: var(--coral);
  background: var(--coral-soft);
}

.reschedule-window__time {
  flex: 1;
  font-family: var(--ff-display);
  font-weight: 800;
}

.reschedule-window__left {
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 700;
}

.reschedule-window ion-icon {
  color: var(--coral);
  font-size: 20px;
}

.reschedule-empty {
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
  text-align: center;
}
</style>
