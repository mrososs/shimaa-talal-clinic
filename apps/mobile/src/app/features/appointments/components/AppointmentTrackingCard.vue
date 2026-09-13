<script setup lang="ts">
import { computed } from 'vue';
import { IonButton } from '@ionic/vue';
import {
  AttendanceIntent,
  EstimateConfidence,
  EstimateUnavailableReason,
  type AppointmentTrackingView,
} from '@clinic/contracts';

const props = defineProps<{
  view: AppointmentTrackingView;
  timezone?: string;
  working: boolean;
}>();
const emit = defineEmits<{
  attendance: [intent: typeof AttendanceIntent.Coming | typeof AttendanceIntent.NotComing];
}>();

const time = (value: string) => new Intl.DateTimeFormat('ar-EG', {
  hour: 'numeric', minute: '2-digit', timeZone: props.timezone,
}).format(new Date(value));
const range = computed(() => props.view.estimate
  ? `${time(props.view.estimate.consultationFrom)} – ${time(props.view.estimate.consultationTo)}`
  : null);
const unavailable = computed(() => {
  if (props.view.appointmentStatus === 'requested') {
    return 'سنحدّث وقت الحضور المقترح بعد تأكيد العيادة للحجز.';
  }
  switch (props.view.unavailableReason) {
    case EstimateUnavailableReason.DoctorStartUnknown:
      return 'يوجد تأخير في بداية العيادة. سيتم تحديث وقت الحضور بمجرد تحديد موعد البدء المتوقع.';
    case EstimateUnavailableReason.ResumeTimeUnknown:
      return 'الطابور متوقف مؤقتًا، وسيتم تحديث الوقت عند تحديد موعد الاستئناف.';
    case EstimateUnavailableReason.PendingApproval:
      return 'سنحدّث وقت الحضور المقترح بعد تأكيد العيادة للحجز.';
    default:
      return null;
  }
});
const confidenceNote = computed(() => {
  if (!props.view.estimate || props.view.estimate.confidence === EstimateConfidence.High)
    return null;
  return props.view.estimate.confidence === EstimateConfidence.Low
    ? 'الوقت تقديري وقد يتغير بعد تحديث العيادة أو تأكيد الحجوزات.'
    : 'الوقت تقديري وقد يتغير قليلًا.';
});
</script>

<template>
  <section class="card tracking-card" aria-labelledby="tracking-title">
    <h2 id="tracking-title">وقت الزيارة المتوقع</h2>
    <template v-if="view.estimate">
      <strong class="tracking-card__range">{{ range }}</strong>
      <p v-if="view.estimate.recommendedArrival">
        الحضور المقترح: <b>{{ time(view.estimate.recommendedArrival) }}</b>
      </p>
      <p v-else-if="view.estimate.arrivalAdvice === 'as_soon_as_practical'">
        يُفضّل الوصول عند الإمكان والتواصل مع العيادة عند الحاجة.
      </p>
      <small v-if="confidenceNote">{{ confidenceNote }}</small>
    </template>
    <p v-else-if="unavailable" class="tracking-card__notice">{{ unavailable }}</p>
    <p v-else class="tracking-card__notice">
      ستحدّث العيادة إرشادات الحضور هنا عند توفرها.
    </p>

    <div v-if="view.attendanceEnabled && view.appointmentStatus === 'confirmed'" class="tracking-card__actions">
      <ion-button
        size="small"
        :fill="view.attendanceIntent === AttendanceIntent.Coming ? 'solid' : 'outline'"
        :disabled="working"
        @click="emit('attendance', AttendanceIntent.Coming)"
      >قادمون</ion-button>
      <ion-button
        size="small"
        color="medium"
        :fill="view.attendanceIntent === AttendanceIntent.NotComing ? 'solid' : 'outline'"
        :disabled="working"
        @click="emit('attendance', AttendanceIntent.NotComing)"
      >لن نحضر</ion-button>
    </div>
  </section>
</template>

<style scoped>
.tracking-card { display: grid; gap: 10px; padding: 18px; }
.tracking-card h2, .tracking-card p { margin: 0; }
.tracking-card__range { color: var(--coral-ink); font-size: 21px; }
.tracking-card__notice, .tracking-card small { color: var(--ink-2); line-height: 1.7; }
.tracking-card__actions { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
