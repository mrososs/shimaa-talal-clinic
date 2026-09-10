import { computed, shallowRef } from 'vue';
import type { GuardianChild, ParentGrowthView } from '@clinic/contracts';
import { apiMessage } from '../../../shared/messages';
import { growthApi, session } from '../../../runtime';

export function useGrowth() {
  const selectedChildId = shallowRef<string | null>(null);
  const view = shallowRef<ParentGrowthView | null>(null);
  const loading = shallowRef(true);
  const refreshing = shallowRef(false);
  const failure = shallowRef<string | null>(null);
  let request = 0;

  const children = computed<readonly GuardianChild[]>(
    () => session.state.identity?.children ?? [],
  );

  async function read(): Promise<void> {
    selectedChildId.value ??= children.value[0]?.id ?? null;
    const childId = selectedChildId.value;
    if (childId === null) {
      view.value = null;
      loading.value = false;
      return;
    }
    const ticket = (request += 1);
    const response = await growthApi.forChild(childId);
    if (ticket !== request) return;
    view.value = response;
  }

  async function refresh(): Promise<void> {
    refreshing.value = true;
    try {
      await read();
      failure.value = null;
    } catch (error) {
      failure.value = apiMessage(error);
    } finally {
      loading.value = false;
      refreshing.value = false;
    }
  }

  async function selectChild(childId: string): Promise<void> {
    if (selectedChildId.value === childId) return;
    selectedChildId.value = childId;
    view.value = null;
    loading.value = true;
    await refresh();
  }

  return {
    children,
    selectedChildId,
    view,
    loading,
    refreshing,
    failure,
    refresh,
    selectChild,
  };
}

export type GrowthState = ReturnType<typeof useGrowth>;
