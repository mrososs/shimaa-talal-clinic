<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import {
  calendarOutline,
  chatbubbleEllipsesOutline,
  checkmarkCircleOutline,
  notificationsOutline,
  timeOutline,
  walletOutline,
} from 'ionicons/icons';
import type { ParentNotification } from '@clinic/contracts';
import { shortDayLabel, timeLabel } from '../../../shared/format';

const props = defineProps<{
  items: readonly ParentNotification[];
  working: boolean;
}>();

const emit = defineEmits<{
  open: [notification: ParentNotification];
}>();

function iconFor(kind: ParentNotification['kind']): string {
  if (kind.startsWith('appointment_')) return calendarOutline;
  if (kind.startsWith('queue_')) return timeOutline;
  if (kind.startsWith('payment_')) return walletOutline;
  if (kind === 'message_reply') return chatbubbleEllipsesOutline;
  if (kind === 'urgent_accepted') return checkmarkCircleOutline;
  return notificationsOutline;
}

function dateLabel(iso: string): string {
  return `${shortDayLabel(iso)} · ${timeLabel(iso)}`;
}
</script>

<template>
  <section v-if="props.items.length" class="notification-list">
    <button
      v-for="item in props.items"
      :key="item.id"
      type="button"
      class="card notification"
      :class="{ 'notification--unread': item.readAt === null }"
      :disabled="props.working"
      @click="emit('open', item)"
    >
      <span class="notification__icon">
        <ion-icon :icon="iconFor(item.kind)" />
      </span>
      <span class="notification__copy">
        <span class="notification__title">{{ item.title }}</span>
        <span class="notification__body">{{ item.body }}</span>
        <span class="notification__date">{{ dateLabel(item.createdAt) }}</span>
      </span>
      <span v-if="item.readAt === null" class="notification__dot" aria-label="غير مقروء" />
    </button>
  </section>

  <section v-else class="card empty">
    <span class="empty__icon"><ion-icon :icon="notificationsOutline" /></span>
    <strong>لا توجد إشعارات حتى الآن</strong>
    <p>ستظهر هنا تحديثات الحجز والدفع والطابور ورسائل العيادة.</p>
  </section>
</template>

<style scoped>
.notification-list {
  display: grid;
  gap: 11px;
}
.notification {
  inline-size: 100%;
  padding: 15px;
  border: 1.5px solid transparent;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  color: var(--ink);
  font: inherit;
  text-align: start;
  cursor: pointer;
  box-shadow: var(--sh-sm);
}
.notification--unread {
  border-color: var(--coral-soft);
  background: linear-gradient(135deg, var(--surface), #fff8f4);
}
.notification__icon {
  inline-size: 42px;
  block-size: 42px;
  flex: 0 0 auto;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: var(--teal-soft);
  color: var(--teal-ink);
  font-size: 21px;
}
.notification__copy {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 4px;
}
.notification__title {
  font: 800 15px var(--ff-display);
}
.notification__body {
  color: var(--ink-2);
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.65;
}
.notification__date {
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
}
.notification__dot {
  inline-size: 9px;
  block-size: 9px;
  margin-block-start: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--coral);
}
.empty {
  min-block-size: 210px;
  padding: 28px 22px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 7px;
  text-align: center;
}
.empty__icon {
  inline-size: 58px;
  block-size: 58px;
  margin-block-end: 5px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--coral-soft);
  color: var(--coral-ink);
  font-size: 28px;
}
.empty p {
  margin: 0;
  color: var(--ink-2);
  line-height: 1.6;
}
</style>
