<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { checkmarkOutline } from 'ionicons/icons';

const props = withDefaults(defineProps<{ active?: number }>(), { active: 4 });
const steps = ['الخدمة', 'الطفل', 'الموعد', 'الدفع', 'الموافقة'];
</script>

<template>
  <ol class="steps" aria-label="مراحل الحجز">
    <li
      v-for="(step, index) in steps"
      :key="step"
      class="steps__item"
      :class="{
        'steps__item--done': index + 1 < props.active,
        'steps__item--active': index + 1 === props.active,
      }"
      :aria-current="index + 1 === props.active ? 'step' : undefined"
    >
      <span class="steps__line" aria-hidden="true" />
      <span class="steps__dot">
        <ion-icon v-if="index + 1 < props.active" :icon="checkmarkOutline" />
        <b v-else>{{ index + 1 }}</b>
      </span>
      <small>{{ step }}</small>
    </li>
  </ol>
</template>

<style scoped>
.steps {
  display: flex;
  align-items: flex-start;
  margin: 0;
  padding: 2px 0 0;
  list-style: none;
}

.steps__item {
  position: relative;
  flex: 1;
  min-width: 0;
  display: grid;
  justify-items: center;
  gap: 5px;
  color: var(--muted);
}

.steps__line {
  position: absolute;
  z-index: 0;
  inset-block-start: 13px;
  inset-inline-start: 50%;
  inline-size: 100%;
  block-size: 3px;
  border-radius: var(--r-pill);
  background: var(--bg-2);
}

.steps__item:last-child .steps__line {
  display: none;
}

.steps__item--done .steps__line {
  background: var(--teal);
}

.steps__dot {
  position: relative;
  z-index: 1;
  inline-size: 28px;
  block-size: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--bg-2);
  color: var(--muted);
  font: 800 12px var(--ff-display);
}

.steps__item--done .steps__dot {
  background: var(--teal);
  color: white;
}

.steps__item--active .steps__dot {
  background: var(--coral);
  color: white;
}

.steps__item--active small {
  color: var(--coral-ink);
}

.steps small {
  max-width: 100%;
  overflow: hidden;
  font-size: 10px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
