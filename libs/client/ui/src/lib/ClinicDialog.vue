<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

/**
 * The modal both apps use.
 *
 * There was one dialog in the dashboard and none in the mobile app, and the
 * mobile app had reached for `window.confirm` instead — which cannot be styled,
 * ignores the page's direction, and reads in the browser's language rather than
 * the clinic's. A parent cancelling a visit deserves the same care as a
 * receptionist marking an emergency.
 *
 * Deliberately plain: no Ionic, no Vue UI framework, nothing but the shared
 * tokens. The dashboard has no Ionic and never will, so anything shared with it
 * has to render without one — the lint rule beside this file says so too.
 *
 * It owns the parts that are easy to get subtly wrong and tedious to repeat:
 * the scrim, Escape, restoring focus to whatever opened it, locking the page
 * behind it, and moving focus into the dialog when it appears. Everything
 * visible is a slot, because what a dialog *says* belongs to the screen using
 * it.
 */

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    /** A line under the title — usually who or what this is about. */
    subject?: string;
    /** Blocks scrim and Escape. For a dialog that must be answered. */
    persistent?: boolean;
  }>(),
  { subject: undefined, persistent: false },
);

const emit = defineEmits<{ close: [] }>();

const panel = ref<HTMLElement | null>(null);
/** Whatever had focus before, so it can be given back on close. */
let opener: Element | null = null;
/** Whether this instance ever opened, so closing undoes only what it did. */
let wasOpen = false;

function dismiss(): void {
  if (props.persistent) return;
  emit('close');
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation();
    dismiss();
  }
}

watch(
  () => props.open,
  async (open) => {
    if (typeof document === 'undefined') return;

    if (open) {
      wasOpen = true;
      opener = document.activeElement;
      // The page behind must not scroll under the dialog: on a phone that
      // reads as the dialog sliding away when the finger moves.
      document.body.style.overflow = 'hidden';
      await nextTick();
      // Focus the panel rather than a button — landing on "confirm" makes the
      // destructive answer one keypress away.
      panel.value?.focus();
      return;
    }

    // Never opened, so there is nothing of ours to undo — this runs on mount
    // for a dialog that starts closed, which is most of them.
    if (!wasOpen) return;
    wasOpen = false;

    document.body.style.overflow = '';
    (opener as HTMLElement | null)?.focus?.();
    opener = null;
  },
  // Immediate, because a dialog can be mounted already open — a screen that
  // wraps it in its own `v-if`, say. Without this it would render, and quietly
  // neither take focus nor lock the page behind it.
  { immediate: true },
);

onBeforeUnmount(() => {
  // A dialog unmounted while open would otherwise leave the page unscrollable.
  if (wasOpen && typeof document !== 'undefined') {
    document.body.style.overflow = '';
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="cd-scrim"
      @click.self="dismiss"
    >
      <div
        ref="panel"
        class="cd-panel"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <header class="cd-head">
          <h2 class="cd-title">
            {{ title }}
          </h2>
          <p
            v-if="subject"
            class="cd-subject"
          >
            {{ subject }}
          </p>
        </header>

        <div class="cd-body">
          <slot />
        </div>

        <footer
          v-if="$slots.actions"
          class="cd-actions"
        >
          <slot name="actions" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cd-scrim {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 20px;
  /* Warm rather than neutral black: the product's shadows are warm too, and a
     grey scrim over cream reads as a rendering fault. */
  background: rgb(60 40 34 / 45%);
}

.cd-panel {
  inline-size: min(440px, 100%);
  max-block-size: min(80vh, 640px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-radius: var(--r-lg, 22px);
  background: var(--surface, #fff);
  color: var(--ink, #3a3340);
  box-shadow: var(--sh-lg, 0 18px 48px rgb(60 40 34 / 22%));
  font-family: var(--ff-body, system-ui, sans-serif);
}

.cd-panel:focus-visible {
  outline: none;
}

.cd-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cd-title {
  margin: 0;
  font-family: var(--ff-display, inherit);
  font-weight: 800;
  font-size: 19px;
  line-height: 1.35;
}

.cd-subject {
  margin: 0;
  font-size: 13.5px;
  color: var(--ink-2, #6b6470);
}

.cd-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cd-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}

@media (prefers-reduced-motion: no-preference) {
  .cd-panel {
    animation: cd-rise 0.22s cubic-bezier(0.2, 0.8, 0.3, 1) both;
  }
}

@keyframes cd-rise {
  from {
    transform: translateY(12px) scale(0.985);
    opacity: 0;
  }
}
</style>
