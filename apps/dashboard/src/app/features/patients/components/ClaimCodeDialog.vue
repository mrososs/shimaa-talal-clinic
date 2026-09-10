<script setup lang="ts">
import { ClinicDialog } from '@clinic/client-ui';
import type { IssuedClaimCode } from '@clinic/contracts';

defineProps<{ open: boolean; familyName?: string; claim: IssuedClaimCode | null }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <ClinicDialog
    :open="open"
    title="رمز ربط حساب العائلة"
    :subject="familyName"
    @close="emit('close')"
  >
    <div
      v-if="claim"
      class="claim"
    >
      <p class="dmuted">
        هذا الرمز يظهر الآن فقط. سلّميه لولي الأمر ليكتبه في التطبيق.
      </p>
      <output
        class="claim__code"
        dir="ltr"
      >{{ claim.code }}</output>
      <p class="dnotice dnotice--warn">
        ينتهي في {{ new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(claim.expiresAt)) }}
      </p>
    </div>
    <template #actions>
      <button
        class="dbtn dbtn--teal"
        type="button"
        @click="emit('close')"
      >
        تم
      </button>
    </template>
  </ClinicDialog>
</template>

<style scoped>
.claim { display: grid; gap: 14px; text-align: center; }
.claim__code { padding: 18px; border: 2px dashed var(--teal); border-radius: 16px; color: var(--teal-ink); background: var(--teal-soft); font-family: ui-monospace, monospace; font-size: clamp(28px, 7vw, 42px); font-weight: 900; letter-spacing: .18em; }
</style>
