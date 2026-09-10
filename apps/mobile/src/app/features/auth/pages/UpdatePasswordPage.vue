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
import { eyeOffOutline, eyeOutline, lockClosedOutline } from 'ionicons/icons';
import AuthHero from '../../../shared/components/AuthHero.vue';
import FieldRow from '../../../shared/components/FieldRow.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { authMessage } from '../../../shared/messages';
import { session } from '../../../runtime';

const MIN_PASSWORD_LENGTH = 8;
const router = useRouter();
const password = ref('');
const confirmation = ref('');
const revealed = ref(false);
const submitted = ref(false);
const state = session.state;

onMounted(() => session.clearAuthError());

const passwordError = computed(() =>
  !submitted.value || password.value.length >= MIN_PASSWORD_LENGTH
    ? null
    : 'كلمة المرور ٨ أحرف على الأقل.',
);
const confirmationError = computed(() =>
  !submitted.value || confirmation.value === password.value
    ? null
    : 'كلمتا المرور غير متطابقتين.',
);
const serverError = computed(() => authMessage(state.authError));

async function submit(): Promise<void> {
  submitted.value = true;
  if (passwordError.value !== null || confirmationError.value !== null) return;

  const updated = await session.updatePassword(password.value);
  if (updated) await router.replace({ name: 'home' });
}
</script>

<template>
  <ion-page>
    <ion-content>
      <auth-hero />

      <main class="screen auth pop">
        <header class="auth__intro">
          <h2 class="title">
            اختاري كلمة مرور جديدة
          </h2>
          <p class="subtitle">
            استخدمي ٨ أحرف على الأقل، ولا تعيدي استخدام كلمة قديمة.
          </p>
        </header>

        <form
          class="stack"
          novalidate
          @submit.prevent="submit"
        >
          <field-row
            for-id="new-password"
            label="كلمة المرور الجديدة"
            :icon="lockClosedOutline"
            :error="passwordError"
          >
            <input
              id="new-password"
              v-model="password"
              :type="revealed ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="••••••••"
              dir="ltr"
              :aria-invalid="passwordError !== null"
              :aria-describedby="
                passwordError ? 'new-password-message' : undefined
              "
            >
            <template #end>
              <button
                type="button"
                class="reveal"
                :aria-label="
                  revealed ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'
                "
                @click="revealed = !revealed"
              >
                <ion-icon :icon="revealed ? eyeOffOutline : eyeOutline" />
              </button>
            </template>
          </field-row>

          <field-row
            for-id="confirm-password"
            label="تأكيد كلمة المرور"
            :icon="lockClosedOutline"
            :error="confirmationError"
          >
            <input
              id="confirm-password"
              v-model="confirmation"
              :type="revealed ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="••••••••"
              dir="ltr"
              :aria-invalid="confirmationError !== null"
              :aria-describedby="
                confirmationError ? 'confirm-password-message' : undefined
              "
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
            <span v-else>حفظ كلمة المرور</span>
          </ion-button>
        </form>
      </main>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.auth {
  padding-block-start: 24px;
}

.auth__intro {
  margin-block-end: 20px;
}

.reveal {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  color: var(--ink-2);
  display: grid;
  place-items: center;
  font-size: 18px;
  cursor: pointer;
}
</style>
