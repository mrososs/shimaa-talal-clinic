import { computed, ref, shallowRef } from 'vue';
import type { Guardian, PageMeta, StaffFamilyRecord } from '@clinic/contracts';
import { apiMessage } from '../../../shared/messages';
import { clinicApi } from '../../../runtime';

export function useFamilyDirectory() {
  const query = ref('');
  const families = shallowRef<Guardian[]>([]);
  const selected = shallowRef<StaffFamilyRecord | null>(null);
  const meta = shallowRef<PageMeta | null>(null);
  const loading = ref(true);
  const loadingMore = ref(false);
  const loadingRecord = ref(false);
  const failure = ref<string | null>(null);

  const selectedId = computed(() => selected.value?.guardian.id ?? null);
  const hasMore = computed(
    () => meta.value !== null && meta.value.page < meta.value.totalPages,
  );

  async function search(): Promise<void> {
    loading.value = true;
    await fetchPage(1);
    loading.value = false;
  }

  async function loadMore(): Promise<void> {
    if (!hasMore.value || loadingMore.value) return;
    loadingMore.value = true;
    await fetchPage((meta.value?.page ?? 0) + 1);
    loadingMore.value = false;
  }

  async function fetchPage(pageNumber: number): Promise<void> {
    failure.value = null;
    try {
      const term = query.value.trim();
      const numeric = term !== '' && /^[\d\s+-]+$/.test(term);
      const page = await clinicApi.searchGuardians(
        term === ''
          ? { page: pageNumber }
          : numeric
            ? { phone: term, page: pageNumber }
            : { q: term, page: pageNumber },
      );
      families.value =
        pageNumber === 1 ? page.items : [...families.value, ...page.items];
      meta.value = page.meta;
      if (
        pageNumber === 1 &&
        selected.value !== null &&
        !page.items.some((guardian) => guardian.id === selected.value?.guardian.id)
      ) {
        selected.value = null;
      }
    } catch (error) {
      failure.value = apiMessage(error);
    }
  }

  async function open(guardianId: string): Promise<void> {
    loadingRecord.value = true;
    failure.value = null;
    try {
      selected.value = await clinicApi.familyRecord(guardianId);
    } catch (error) {
      failure.value = apiMessage(error);
    } finally {
      loadingRecord.value = false;
    }
  }

  async function refreshSelected(): Promise<void> {
    if (selectedId.value !== null) await open(selectedId.value);
  }

  return {
    query,
    families,
    selected,
    meta,
    selectedId,
    loading,
    loadingMore,
    hasMore,
    loadingRecord,
    failure,
    search,
    loadMore,
    open,
    refreshSelected,
  };
}

export type FamilyDirectoryState = ReturnType<typeof useFamilyDirectory>;
