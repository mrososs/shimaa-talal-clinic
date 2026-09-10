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
import { arrowBackOutline, callOutline } from 'ionicons/icons';
import { normalizeToE164, PhoneRegion } from '@clinic/phone';
import AuthHero from '../../../shared/components/AuthHero.vue';
import FieldRow from '../../../shared/components/FieldRow.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { authMessage } from '../../../shared/messages';
import { session } from '../../../runtime';
import { saveOtpChallenge } from '../otp-challenge';

const router = useRouter();
const phone = ref('');
const submitted = ref(false);
const state = session.state;

onMounted(() => session.clearAuthError());

const normalizedPhone = computed(() =>
  normalizeToE164(phone.value, PhoneRegion.Egypt),
);
const phoneError = computed(() =>
  !submitted.value || normalizedPhone.value !== null
    ? null
    : 'أدخلي رقم موبايل صحيحاً، مثل ٠١٠١٢٣٤٥٦٧٨.',
);
const serverError = computed(() => authMessage(state.authError));

async function submit(): Promise<void> {
  submitted.value = true;
  if (normalizedPhone.value === null) return;

  const sent = await session.startPhoneOtp(normalizedPhone.value);
  if (!sent) return;

  saveOtpChallenge(normalizedPhone.value);
  await router.push({ name: 'phone-otp' });
}
</script>

<template>
  <ion-page>
    <ion-content>
      <auth-hero />

      <main class="screen auth pop">
        <button
          type="button"
          class="back"
          aria-label="العودة إلى تسجيل الدخول"
          @click="router.back()"
        >
          <ion-icon :icon="arrowBackOutline" />
        </button>

        <header class="auth__intro">
          <h2 class="title">
            الدخول برقم الموبايل
          </h2>
          <p class="subtitle">
            سنرسل رمز تحقق قصيراً في رسالة SMS. لن تحتاجي إلى كلمة مرور.
          </p>
        </header>

        <form
          class="stack"
          novalidate
          @submit.prevent="submit"
        >
          <field-row
            for-id="phone-sign-in"
            label="رقم الموبايل"
            :icon="callOutline"
            :error="phoneError"
            hint="يمكنك كتابة الرقم المحلي أو بصيغة +20"
          >
            <input
              id="phone-sign-in"
              v-model="phone"
              type="tel"
              inputmode="tel"
              autocomplete="tel"
              placeholder="٠١٠١٢٣٤٥٦٧٨"
              dir="ltr"
              :aria-invalid="phoneError !== null"
              aria-describedby="phone-sign-in-message"
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
            <span v-else>إرسال رمز التحقق</span>
          </ion-button>

          <p class="privacy-note">
            تسجيل الدخول يثبت ملكية الرقم فقط. الوصول إلى ملف عائلة موجودة يظل
            بحاجة إلى رمز الربط الصادر من الاستقبال.
          </p>
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

.privacy-note {
  margin: 0;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.75;
  text-align: center;
}
</style>
