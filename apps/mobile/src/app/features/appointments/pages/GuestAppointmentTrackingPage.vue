<script setup lang="ts">
import { IonSpinner, onIonViewDidLeave, onIonViewWillEnter } from '@ionic/vue';
import ScreenShell from '../../../shared/components/ScreenShell.vue';
import AppointmentTrackingCard from '../components/AppointmentTrackingCard.vue';
import { useGuestAppointmentTracking } from '../composables/useGuestAppointmentTracking';

const token = () => window.location.hash.replace(/^#/, '');
const tracking = useGuestAppointmentTracking(token);
onIonViewWillEnter(() => void tracking.open());
onIonViewDidLeave(() => tracking.close());
</script>

<template>
  <ScreenShell title="متابعة الزيارة" subtitle="رابط خاص من العيادة">
    <section v-if="tracking.loading.value" class="card guest-state">
      <IonSpinner name="crescent" /><span>جارٍ تحميل المتابعة…</span>
    </section>
    <section v-else-if="tracking.failure.value" class="card guest-state" role="alert">
      <h2>الرابط غير متاح</h2><p>{{ tracking.failure.value }}</p>
      <button type="button" @click="tracking.refresh">إعادة المحاولة</button>
    </section>
    <div v-else-if="tracking.view.value" class="guest-stack">
      <AppointmentTrackingCard
        :view="tracking.view.value"
        :working="tracking.working.value"
        @attendance="tracking.setAttendance"
      />
      <section v-if="tracking.view.value.queue" class="card guest-queue">
        <span>رقم الدور</span><strong>{{ tracking.view.value.queue.ticketNumber }}</strong>
        <p>أمامكم {{ tracking.view.value.queue.aheadCount }} في الطابور</p>
      </section>
      <p class="guest-privacy">الرابط لا يعرض اسم الطفل أو أي بيانات طبية.</p>
    </div>
  </ScreenShell>
</template>

<style scoped>
.guest-state { min-height: 220px; display: grid; place-items: center; align-content: center; gap: 12px; text-align: center; padding: 24px; }
.guest-stack { display: grid; gap: 16px; }
.guest-queue { display: grid; justify-items: center; gap: 8px; padding: 22px; }
.guest-queue strong { font-size: 48px; color: var(--teal); }
.guest-queue p, .guest-privacy { color: var(--ink-2); text-align: center; }
</style>
