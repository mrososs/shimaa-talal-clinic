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
  <div class="shell">
    <aside
      v-if="member"
      class="shell__nav"
    >
      <div class="shell__brand">
        <p class="shell__clinic">
          {{ clinic?.name ?? 'العيادة' }}
        </p>
        <p class="c-muted shell__role">
          {{ member.displayName }} ·
          {{ ROLE_LABELS[member.role] ?? member.role }}
        </p>
      </div>

      <nav class="shell__links">
        <router-link
          v-for="link in links"
          :key="link.name"
          class="shell__link"
          :to="{ name: link.name }"
        >
          {{ link.label }}
        </router-link>
      </nav>

      <button
        class="c-btn c-btn--ghost c-btn--block"
        :disabled="signingOut"
        @click="signOut"
      >
        {{ signingOut ? '...' : 'تسجيل الخروج' }}
      </button>
    </aside>

    <main class="shell__main">
      <section
        v-if="state.identityError === 'forbidden'"
        class="shell__blocked"
      >
        <div class="c-card c-stack">
          <h1 class="c-title">
            لا صلاحية لهذا الحساب
          </h1>
          <p class="c-muted">
            هذا الحساب ليس مسجَّلاً ضمن فريق العيادة. إن كنتِ من الفريق،
            تواصلي مع مسؤول العيادة لإضافة حسابك.
          </p>
          <button
            class="c-btn c-btn--ghost"
            :disabled="signingOut"
            @click="signOut"
          >
            تسجيل الخروج
          </button>
        </div>
      </section>

      <section
        v-else-if="state.identityError === 'unavailable'"
        class="shell__blocked"
      >
        <div class="c-card c-stack">
          <h1 class="c-title">
            تعذَّر الاتصال بالخادم
          </h1>
          <p class="c-muted">
            لم نتمكن من تحميل بيانات العيادة. تحقّقي من الاتصال ثم أعيدي
            المحاولة.
          </p>
          <button
            class="c-btn"
            @click="session.refreshIdentity()"
          >
            إعادة المحاولة
          </button>
        </div>
      </section>

      <router-view v-else />
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  /* Logical placement: the sidebar sits on the reading-start side, which is
     the right under RTL, without a single direction-specific rule. */
  grid-template-columns: 248px 1fr;
  min-height: 100vh;
}

.shell__nav {
  display: flex;
  flex-direction: column;
  gap: var(--c-space-lg);
  padding: var(--c-space-lg) var(--c-space);
  background: var(--c-surface);
  border-inline-end: 1px solid var(--c-border);
}

.shell__brand {
  display: flex;
  flex-direction: column;
  gap: var(--c-space-xs);
}

.shell__clinic {
  margin: 0;
  font-weight: 700;
  color: var(--c-primary);
}

.shell__role {
  margin: 0;
  font-size: 0.85rem;
}

.shell__links {
  display: flex;
  flex-direction: column;
  gap: var(--c-space-xs);
  flex: 1;
}

.shell__link {
  padding: 10px 12px;
  border-radius: var(--c-radius-sm);
  color: var(--c-text);
  text-decoration: none;
  font-weight: 600;
}

.shell__link:hover {
  background: var(--c-surface-muted);
}

.shell__link.router-link-active {
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.shell__main {
  padding: var(--c-space-lg);
  overflow-x: auto;
}

.shell__blocked {
  display: grid;
  place-items: center;
  min-height: 60vh;
}

.shell__blocked .c-card {
  max-width: 460px;
}

@media (max-width: 720px) {
  .shell {
    grid-template-columns: 1fr;
  }

  .shell__nav {
    border-inline-end: none;
    border-block-end: 1px solid var(--c-border);
  }

  .shell__links {
    flex-direction: row;
    flex-wrap: wrap;
  }
}
</style>
