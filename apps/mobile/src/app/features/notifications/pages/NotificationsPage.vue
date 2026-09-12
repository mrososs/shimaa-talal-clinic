<script setup lang="ts">
import { IonButton, IonRefresher, IonRefresherContent, IonSpinner, onIonViewDidLeave, onIonViewWillEnter, type RefresherCustomEvent } from '@ionic/vue';
import { useRouter } from 'vue-router';
import type { ParentNotification } from '@clinic/contracts';
import ScreenShell from '../../../shared/components/ScreenShell.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import NotificationList from '../components/NotificationList.vue';
import { useParentNotifications } from '../composables/useParentNotifications';

const router = useRouter();
const notifications = useParentNotifications();

async function refresh(event?: RefresherCustomEvent): Promise<void> {
  await notifications.refresh();
  await event?.target.complete();
}

async function openNotification(item: ParentNotification): Promise<void> {
  await notifications.markRead(item);
  await router.push(item.deepLink);
}

onIonViewWillEnter(() => void notifications.open());
onIonViewDidLeave(() => notifications.close());
</script>

<template>
  <screen-shell
    title="الإشعارات"
    subtitle="آخر تحديثات الحجز والدفع والطابور"
    :back-to="{ name: 'home' }"
  >
    <template #above>
      <ion-refresher slot="fixed" @ion-refresh="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>
    </template>
    <template #header-end>
      <ion-button
        v-if="notifications.hasUnread.value"
        fill="clear"
        size="small"
        :disabled="notifications.working.value"
        @click="notifications.markAllRead"
      >
        تعليم الكل كمقروء
      </ion-button>
    </template>

    <form-notice :message="notifications.failure.value" />
    <div v-if="notifications.loading.value" class="card loading">
      <ion-spinner name="crescent" />
    </div>
    <notification-list
      v-else
      :items="notifications.items.value"
      :working="notifications.working.value"
      @open="openNotification"
    />
  </screen-shell>
</template>

<style scoped>
.loading {
  min-block-size: 180px;
  display: grid;
  place-items: center;
}
</style>
