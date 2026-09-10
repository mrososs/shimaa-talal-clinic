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
import { arrowBackOutline, mailOutline } from 'ionicons/icons';
import AuthHero from '../../../shared/components/AuthHero.vue';
import FieldRow from '../../../shared/components/FieldRow.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { authMessage } from '../../../shared/messages';
import { session } from '../../../runtime';

const router = useRouter();
const email = ref('');
const submitted = ref(false);
const sent = ref(false);
const state = session.state;

onMounted(() => session.clearAuthError());

const emailError = computed(() =>
  !submitted.value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())
    ? null
    : 'أدخلي بريداً إلكترونياً صحيحاً.',
);
const serverError = computed(() => authMessage(state.authError));

async function submit(): Promise<void> {
  submitted.value = true;
  sent.value = false;
  if (emailError.value !== null) return;

  sent.value = await session.requestPasswordReset(
    email.value.trim(),
    `${window.location.origin}/auth/update-password`,
  );
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
            استعادة كلمة المرور
          </h2>
          <p class="subtitle">
            اكتبي بريدك وسنرسل رابطاً آمناً لإعادة تعيين كلمة المرور.
          </p>
        </header>

        <form
          class="stack"
          novalidate
          @submit.prevent="submit"
        >
          <field-row
            for-id="reset-email"
            label="البريد الإلكتروني"
            :icon="mailOutline"
            :error="emailError"
          >
            <input
              id="reset-email"
              v-model="email"
              type="email"
              inputmode="email"
              autocomplete="email"
              placeholder="name@email.com"
              dir="ltr"
              :aria-invalid="emailError !== null"
              :aria-describedby="emailError ? 'reset-email-message' : undefined"
            >
          </field-row>

          <form-notice :message="serverError" />
          <form-notice
            tone="info"
            :message="
              sent
                ? 'إذا كان البريد مسجَّلاً، ستصلك رسالة الاستعادة خلال دقائق.'
                : null
            "
          />

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
            <span v-else>إرسال رابط الاستعادة</span>
          </ion-button>
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
</style>
