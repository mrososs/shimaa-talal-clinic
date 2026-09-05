<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { session } from '../runtime';
import { navigationFor } from './navigation';

/**
 * The frame every staff screen renders inside: identity, navigation, sign-out.
 *
 * It also owns the two states that are not screens — an account with no clinic
 * membership, and an identity that could not be loaded. Both are reachable by
 * signing in correctly, so neither is an error page; they are what this shell
 * shows instead of a sidebar.
 */

const router = useRouter();
const state = session.state;
const signingOut = ref(false);

const member = computed(() => state.identity?.member ?? null);
const clinic = computed(() => state.identity?.clinic ?? null);
const links = computed(() => navigationFor(member.value?.role ?? null));

const ROLE_LABELS: Record<string, string> = {
  doctor: 'الطبيبة',
  // The clinic's own word for this role. The stored value stays `reception`.
  reception: 'مساعدة العيادة',
  admin: 'مسؤول',
};

/** The clinic's initial, for the brand tile. */
const brandInitial = computed(() => clinic.value?.name?.trim().at(0) ?? 'ع');

async function signOut(): Promise<void> {
  signingOut.value = true;
  try {
    await session.signOut();
    await router.replace({ name: 'sign-in' });
  } finally {
    signingOut.value = false;
  }
}
</script>

<template>
  <div class="dash">
    <aside
      v-if="member"
      class="dash-side"
    >
      <div class="dash-brand">
        <div class="dash-brand__logo">
          {{ brandInitial }}
        </div>
        <div>
          <p class="dash-brand__name">
            {{ clinic?.name ?? 'العيادة' }}
          </p>
          <p class="dash-brand__role">
            {{ member.displayName }} ·
            {{ ROLE_LABELS[member.role] ?? member.role }}
          </p>
        </div>
      </div>

      <nav class="dash-nav">
        <router-link
          v-for="link in links"
          :key="link.name"
          class="dash-navbtn"
          active-class="dash-navbtn--active"
          :to="{ name: link.name }"
        >
          {{ link.label }}
        </router-link>
      </nav>

      <button
        class="dbtn dbtn--ghost dbtn--block"
        :disabled="signingOut"
        @click="signOut"
      >
        {{ signingOut ? '...' : 'تسجيل الخروج' }}
      </button>
    </aside>

    <main class="dash-main">
      <section
        v-if="state.identityError === 'forbidden'"
        class="dash-blocked"
      >
        <div class="dcard dcard--pad dstack">
          <h1>لا صلاحية لهذا الحساب</h1>
          <p class="dmuted">
            هذا الحساب ليس مسجَّلاً ضمن فريق العيادة. إن كنتِ من الفريق،
            تواصلي مع مسؤول العيادة لإضافة حسابك.
          </p>
          <button
            class="dbtn dbtn--ghost"
            :disabled="signingOut"
            @click="signOut"
          >
            تسجيل الخروج
          </button>
        </div>
      </section>

      <section
        v-else-if="state.identityError === 'unavailable'"
        class="dash-blocked"
      >
        <div class="dcard dcard--pad dstack">
          <h1>تعذَّر الاتصال بالخادم</h1>
          <p class="dmuted">
            لم نتمكن من تحميل بيانات العيادة. تحقّقي من الاتصال ثم أعيدي
            المحاولة.
          </p>
          <button
            class="dbtn dbtn--primary"
            @click="session.refreshIdentity()"
          >
            إعادة المحاولة
          </button>
        </div>
      </section>

      <!--
        The scroll container, and the only place page padding is defined. A
        screen that set its own would drift from every other one.
      -->
      <div
        v-else
        class="dash-content"
      >
        <router-view />
      </div>
    </main>
  </div>
</template>

<style scoped>
.dash-blocked {
  display: grid;
  place-items: center;
  min-height: 70vh;
  padding: 24px;
}

.dash-blocked .dcard {
  max-width: 460px;
}

@media (max-width: 720px) {
  .dash {
    flex-direction: column;
  }

  .dash-side {
    width: 100%;
    border-inline-end: none;
    border-block-end: 1px solid var(--line);
  }

  .dash-nav {
    flex-direction: row;
    flex-wrap: wrap;
  }
}
</style>
