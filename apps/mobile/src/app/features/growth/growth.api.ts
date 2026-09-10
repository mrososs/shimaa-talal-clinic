import type { ApiClient } from '@clinic/api-client';
import type { ParentGrowthView } from '@clinic/contracts';

export function createGrowthApi(client: ApiClient) {
  return {
    forChild: (childId: string): Promise<ParentGrowthView> =>
      client.get<ParentGrowthView>(`children/${childId}/growth`),
  };
}

export type GrowthApi = ReturnType<typeof createGrowthApi>;
