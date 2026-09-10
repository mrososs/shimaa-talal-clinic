<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { medkitOutline } from 'ionicons/icons';

/**
 * The gradient header both auth screens open with.
 *
 * The two translucent circles are the design's, and they are what stops the
 * gradient reading as a flat banner. They sit outside the box on purpose, so
 * the shape is cropped rather than centred.
 */
</script>

<template>
  <header class="hero hero-grad">
    <span class="hero__blob hero__blob--lg" aria-hidden="true" />
    <span class="hero__blob hero__blob--sm" aria-hidden="true" />

    <div class="hero__badge">
      <ion-icon :icon="medkitOutline" />
    </div>
    <h1 class="hero__name">عيادة د. شيماء طلال</h1>
    <p class="hero__tagline">لطب الأطفال وحديثي الولادة</p>
  </header>
</template>

<style scoped>
.hero {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: calc(34px + var(--ion-safe-area-top, 0px)) 24px 30px;
  color: #fff;
  text-align: center;
  border-end-start-radius: var(--r-xl);
  border-end-end-radius: var(--r-xl);
}

.hero__blob {
  position: absolute;
  border-radius: var(--r-pill);
  background: rgba(255, 255, 255, 0.12);
}

.hero__blob--lg {
  width: 130px;
  height: 130px;
  top: -20px;
  inset-inline-start: -30px;
}

.hero__blob--sm {
  width: 100px;
  height: 100px;
  bottom: -40px;
  inset-inline-end: -20px;
  background: rgba(255, 255, 255, 0.1);
}

.hero__badge {
  position: relative;
  width: 76px;
  height: 76px;
  border-radius: var(--r-lg);
  background: rgba(255, 255, 255, 0.22);
  display: grid;
  place-items: center;
  font-size: 34px;
}

.hero__name {
  position: relative;
  font-family: var(--ff-display);
  font-size: 22px;
  font-weight: 700;
  margin: 0;
}

.hero__tagline {
  position: relative;
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  opacity: 0.92;
}
</style>
