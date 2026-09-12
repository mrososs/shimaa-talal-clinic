<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { chevronDownOutline } from 'ionicons/icons';
import type { FaqTopic } from '../faq.data';

defineProps<{
  topics: readonly FaqTopic[];
}>();
</script>

<template>
  <section class="faq-list" aria-label="الأسئلة المتكررة">
    <details v-for="topic in topics" :key="topic.id" class="card faq">
      <summary class="faq__question">
        <span>{{ topic.question }}</span>
        <ion-icon :icon="chevronDownOutline" />
      </summary>
      <p class="faq__answer">{{ topic.answer }}</p>
    </details>
  </section>
</template>

<style scoped>
.faq-list {
  display: grid;
  gap: 11px;
}
.faq {
  padding: 0;
  overflow: hidden;
  box-shadow: var(--sh-sm);
}
.faq__question {
  min-block-size: 58px;
  padding: 15px 17px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  font: 800 15px var(--ff-display);
  list-style: none;
}
.faq__question::-webkit-details-marker {
  display: none;
}
.faq__question ion-icon {
  flex: 0 0 auto;
  color: var(--coral-ink);
  transition: transform 160ms ease;
}
.faq[open] .faq__question ion-icon {
  transform: rotate(180deg);
}
.faq__answer {
  margin: 0;
  padding: 0 17px 17px;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.8;
}
@media (prefers-reduced-motion: reduce) {
  .faq__question ion-icon {
    transition: none;
  }
}
</style>
