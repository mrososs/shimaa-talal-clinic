<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonButton,
  IonContent,
  IonInput,
  IonPage,
  IonSpinner,
} from '@ionic/vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { apiMessage } from '../../../shared/messages';
import { arabicDigits } from '../../../shared/numerals';
import { identityApi, session } from '../../../runtime';

/**
 * Link this account to a family the clinic already has on file.
 *
 * The number matching is not what authorises this. Phone ownership is
 * unverified in this MVP, so a matching number would otherwise mean anyone who
 * guessed it could open somebody's family. The six-digit code, issued by
 * reception to the person in front of them or on the call, is the authorisation.
 *
 * There is no way to "create a new profile with this number instead": a phone
 * is unique per clinic, so the only honest choices are to claim the family or
 * to use a different number.
 */

const router = useRouter();
const route = useRoute();

const phone = computed(() => String(route.query['phone'] ?? ''));
const code = ref('');
const submitted = ref(false);
const pending = ref(false);
const failure = ref<string | null>(null);

const codeError = computed(() =>
  !submitted.value || /^\d{6}$/.test(code.value.trim())
    ? null
    : 'الرمز مكوَّن من ٦ أرقام.',
);

async function submit(): Promise<void> {
  submitted.value = true;
  failure.value = null;
  if (codeError.value !== null) return;

  pending.value = true;
  try {
    await identityApi.claim(phone.value, code.value.trim());
    await session.refreshIdentity();
    // The guard routes on from here: straight home if reception already added
    // the children, or to the child screen if not.
    await router.replace({ name: 'home' });
  } catch (error) {
    failure.value = apiMessage(error);
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <ion-page>
    <ion-content>
      <div class="screen onboarding">
        <header>
          <h1 class="title">
            هذا الرقم مسجَّل لدينا
          </h1>
          <p class="subtitle">
            لدى العيادة ملف عائلي مرتبط بالرقم
            <span class="phone">{{ arabicDigits(phone) }}</span>. لربطه بحسابك، اطلبي من الاستقبال رمز التأكيد المكوَّن من ٦ أرقام.
          </p>
        </header>

        <div class="card hint">
          <p class="subtle">
            الرمز صالح لمدة ١٥ دقيقة ويُستخدم مرة واحدة. لا يُرسَل عبر رسالة —
            تحصلين عليه من الاستقبال مباشرةً أو أثناء المكالمة.
          </p>
        </div>

        <form
          class="stack"
          novalidate
          @submit.prevent="submit"
        >
          <ion-input
            v-model="code"
            label="رمز التأكيد"
            label-placement="stacked"
            type="text"
            inputmode="numeric"
            :maxlength="6"
            fill="outline"
            class="code"
            :class="{ 'ion-invalid': codeError, 'ion-touched': submitted }"
            :error-text="codeError ?? undefined"
          />

          <form-notice :message="failure" />

          <div class="actions">
            <ion-button
              type="submit"
              expand="block"
              size="large"
              :disabled="pending"
            >
              <ion-spinner
                v-if="pending"
                name="crescent"
              />
              <span v-else>ربط الحساب</span>
            </ion-button>

            <ion-button
              fill="clear"
              expand="block"
              :disabled="pending"
              @click="router.replace({ name: 'onboarding-guardian' })"
            >
              استخدام رقم آخر
            </ion-button>
          </div>
        </form>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.onboarding {
  max-width: 480px;
  margin-inline: auto;
}

.hint {
  margin-block: 16px;
}

.hint p {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.7;
}

.phone {
  font-weight: 700;
  color: var(--ink);
  direction: ltr;
  unicode-bidi: embed;
}

.code {
  letter-spacing: 0.4em;
  font-size: 1.3rem;
  text-align: center;
}
</style>
