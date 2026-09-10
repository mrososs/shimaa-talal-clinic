import { effectScope } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParentGrowthView } from '@clinic/contracts';

const api = { forChild: vi.fn() };
const state = {
  identity: {
    children: [
      { id: 'child-1', fullName: 'لين' },
      { id: 'child-2', fullName: 'آدم' },
    ],
  },
};
vi.mock('../../../runtime', () => ({
  growthApi: api,
  session: { state },
}));

const { useGrowth } = await import('./useGrowth');

function view(childId: string): ParentGrowthView {
  return {
    child: {
      id: childId,
      fullName: childId === 'child-1' ? 'لين' : 'آدم',
      dateOfBirth: null,
      sex: null,
    },
    measurements: [],
  };
}

function mount() {
  const scope = effectScope();
  const growth = scope.run(() => useGrowth());
  if (growth === undefined) throw new Error('scope did not run');
  return { growth, dispose: () => scope.stop() };
}

describe('useGrowth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.forChild.mockImplementation(async (childId: string) => view(childId));
  });

  it('loads the first child without accepting an owner id from the UI', async () => {
    const { growth, dispose } = mount();

    await growth.refresh();

    expect(api.forChild).toHaveBeenCalledWith('child-1');
    expect(growth.view.value?.child.id).toBe('child-1');
    dispose();
  });

  it('switches children and clears the old chart while reading', async () => {
    const { growth, dispose } = mount();
    await growth.refresh();

    await growth.selectChild('child-2');

    expect(api.forChild).toHaveBeenLastCalledWith('child-2');
    expect(growth.view.value?.child.id).toBe('child-2');
    dispose();
  });

  it('keeps the last safe view visible if a refresh fails', async () => {
    const { growth, dispose } = mount();
    await growth.refresh();
    api.forChild.mockRejectedValueOnce(new Error('offline'));

    await growth.refresh();

    expect(growth.view.value?.child.id).toBe('child-1');
    expect(growth.failure.value).toBeTruthy();
    dispose();
  });
});
