<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonPage,
  IonSpinner,
} from '@ionic/vue';
import { arrowBackOutline, keypadOutline } from 'ionicons/icons';
import { formatForDisplay } from '@clinic/phone';
import AuthHero from '../../../shared/components/AuthHero.vue';
import FieldRow from '../../../shared/components/FieldRow.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { authMessage } from '../../../shared/messages';
import { arabicDigits, latinDigits } from '../../../shared/numerals';
import { session } from '../../../runtime';
import { useOtpCooldown } from '../composables/useOtpCooldown';
import {
  clearOtpChallenge,
  readOtpChallenge,
  saveOtpChallenge,
} from '../otp-challenge';

const router = useRouter();
const challenge = ref(readOtpChallenge());
const token = ref('');
const submitted = ref(false);
const state = session.state;
const cooldown = useOtpCooldown(challenge.value?.issuedAt ?? 0);

onMounted(async () => {
  session.clearAuthError();
  if (challenge.value === null) {
    await router.replace({ name: 'phone-sign-in' });
  }
});

const normalizedToken = computed(() =>
  latinDigits(token.value).replace(/\D/g, ''),
);
const tokenError = computed(() =>
  !submitted.value || /^\d{6}$/.test(normalizedToken.value)
    ? null
    : 'أدخلي رمز التحقق المكوَّن من ٦ أرقام.',
);
const serverError = computed(() => authMessage(state.authError));
const phoneLabel = computed(() =>
  challenge.value === null
    ? ''
    : arabicDigits(formatForDisplay(challenge.value.phone)),
);

async function submit(): Promise<void> {
  submitted.value = true;
  const current = challenge.value;
  if (current === null || tokenError.value !== null) return;

  const verified = await session.verifyPhoneOtp({
    phone: current.phone,
    token: normalizedToken.value,
  });
  if (!verified) return;

  clearOtpChallenge();
  await router.replace({ name: 'home' });
}

async function resend(): Promise<void> {
  const current = challenge.value;
  if (current === null || !cooldown.canResend.value) return;

  const sent = await session.startPhoneOtp(current.phone);
  if (!sent) return;

  challenge.value = saveOtpChallenge(current.phone);
  cooldown.restart(challenge.value.issuedAt);
}
</script>

<template>
  <ion-page>
    <ion-content>
      <auth-hero />

      <main
        v-if="challenge"
        class="screen auth pop"
      >
        <button
          type="button"
          class="back"
          aria-label="تغيير رقم الموبايل"
          @click="router.replace({ name: 'phone-sign-in' })"
        >
          <ion-icon :icon="arrowBackOutline" />
        </button>

        <header class="auth__intro">
          <h2 class="title">
            أدخلي رمز التحقق
          </h2>
          <p class="subtitle">
            أرسلنا رمزاً من ٦ أرقام إلى
            <strong class="phone">{{ phoneLabel }}</strong>
          </p>
        </header>

        <form
          class="stack"
          novalidate
          @submit.prevent="submit"
        >
          <field-row
            for-id="phone-otp"
            label="رمز التحقق"
            :icon="keypadOutline"
            :error="tokenError"
          >
            <input
              id="phone-otp"
              v-model="token"
              class="otp-input"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              placeholder="••••••"
              dir="ltr"
              :aria-invalid="tokenError !== null"
              :aria-describedby="tokenError ? 'phone-otp-message' : undefined"
            >
          </field-row>

          <form-notice :message="serverError" />

          <ion-button
            type="submit"
            expand="block"
            size="large"
            :disabled="state.pending"
          >
            <ion-spinner
              v-if="state.pending"
              name="crescent"
            />
            <span v-else>تأكيد ومتابعة</span>
          </ion-button>

          <button
            type="button"
            class="resend"
            :disabled="state.pending || !cooldown.canResend.value"
            @click="resend"
          >
            <span v-if="cooldown.canResend.value">إرسال رمز جديد</span>
            <span v-else>
              يمكنك إعادة الإرسال بعد
              {{ arabicDigits(cooldown.remainingSeconds.value) }} ثانية
            </span>
          </button>
        </form>
      </main>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.auth {
  position: relative;
  padding-block-start: 24px;
}

.back {
  position: absolute;
  inset-block-start: 12px;
  inset-inline-end: 16px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--r-pill);
  background: var(--surface);
  box-shadow: var(--sh-sm);
  color: var(--ink-2);
  font-size: 20px;
}

.auth__intro {
  padding-inline-end: 44px;
  margin-block-end: 20px;
}

.phone {
  display: inline-block;
  color: var(--teal-ink);
  direction: ltr;
  unicode-bidi: isolate;
}

.otp-input {
  text-align: center;
  letter-spacing: 0.45em;
  font-family: var(--ff-display) !important;
  font-size: 21px !important;
}

.resend {
  width: 100%;
  border: none;
  background: none;
  color: var(--coral-ink);
  font-family: var(--ff-body);
  font-size: 13.5px;
  font-weight: 800;
  cursor: pointer;
}

.resend:disabled {
  color: var(--muted);
  cursor: default;
}
</style>
