<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, type RouteRecordName } from 'vue-router';
import type { ClinicMember } from '@clinic/contracts';
import { navigationSectionsFor } from '../navigation';
import DashboardNavIcon from './DashboardNavIcon.vue';

const props = defineProps<{
  member: ClinicMember;
  clinicName: string;
  activeRouteName?: RouteRecordName | null;
  signingOut: boolean;
}>();

const emit = defineEmits<{ signOut: [] }>();

const sections = computed(() => navigationSectionsFor(props.member.role));
const brandInitial = computed(() => props.clinicName.trim().at(0) ?? 'ع');

const roleLabel = computed(() => {
  switch (props.member.role) {
    case 'doctor':
      return 'الطبيبة';
    case 'reception':
      return 'المساعدة';
    case 'admin':
      return 'مسؤول النظام';
    default:
      return props.member.role;
  }
});
</script>

<template>
  <aside class="dash-side">
    <div class="dash-brand">
      <div
        class="dash-brand__logo"
        aria-hidden="true"
      >
        {{ brandInitial }}
      </div>
      <div class="dash-brand__copy">
        <p class="dash-brand__name">
          {{ clinicName }}
        </p>
        <p class="dash-brand__role">
          {{ member.displayName }} · {{ roleLabel }}
        </p>
      </div>
    </div>

    <nav
      class="dash-nav"
      aria-label="التنقل الرئيسي"
    >
      <section
        v-for="section in sections"
        :key="section.id"
        class="dash-nav__section"
      >
        <p class="dash-nav__heading">
          {{ section.label }}
        </p>
        <div class="dash-nav__links">
          <RouterLink
            v-for="link in section.links"
            :key="link.name"
            class="dash-navbtn"
            :class="{
              'dash-navbtn--active': activeRouteName === link.name,
            }"
            :aria-current="activeRouteName === link.name ? 'page' : undefined"
            :to="{ name: link.name }"
          >
            <span class="dash-navbtn__icon">
              <DashboardNavIcon :name="link.icon" />
            </span>
            <span>{{ link.label }}</span>
          </RouterLink>
        </div>
      </section>
    </nav>

    <button
      class="dbtn dbtn--ghost dbtn--block dash-side__signout"
      type="button"
      :disabled="signingOut"
      @click="emit('signOut')"
    >
      {{ signingOut ? 'جارٍ تسجيل الخروج…' : 'تسجيل الخروج' }}
    </button>
  </aside>
</template>

<style scoped>
.dash-brand__copy {
  min-width: 0;
}

.dash-brand__name,
.dash-brand__role {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dash-nav__section {
  display: grid;
  gap: 6px;
}

.dash-nav__heading {
  padding-inline: 13px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.dash-nav__links {
  display: grid;
  gap: 3px;
}

.dash-navbtn__icon {
  width: 32px;
  height: 32px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  color: var(--muted);
  background: var(--surface-2);
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.dash-navbtn:hover .dash-navbtn__icon,
.dash-navbtn--active .dash-navbtn__icon {
  color: var(--coral-ink);
  background: color-mix(in srgb, var(--coral-soft) 72%, var(--surface));
}

.dash-side__signout {
  margin-top: 18px;
}

@media (max-width: 860px) {
  .dash-nav__heading {
    display: none;
  }

  .dash-nav__links {
    display: flex;
    flex-wrap: wrap;
  }

  .dash-side__signout {
    width: auto;
    margin-top: 0;
  }
}
</style>
