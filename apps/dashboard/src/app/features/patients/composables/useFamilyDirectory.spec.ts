import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../runtime', () => ({
  clinicApi: {
    searchGuardians: vi.fn(),
    familyRecord: vi.fn(),
  },
}));

import { clinicApi } from '../../../runtime';
import { useFamilyDirectory } from './useFamilyDirectory';

describe('useFamilyDirectory', () => {
  it('uses the server phone search and opens the scoped family record', async () => {
    const guardian = { id: 'guardian-1', fullName: 'سارة' };
    const record = {
      guardian,
      children: [],
      upcomingVisits: [],
      pastVisits: [],
    };
    vi.mocked(clinicApi.searchGuardians).mockResolvedValue({
      items: [guardian] as never,
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    vi.mocked(clinicApi.familyRecord).mockResolvedValue(record as never);
    const directory = useFamilyDirectory();
    directory.query.value = '0100 000 0000';

    await directory.search();
    await directory.open('guardian-1');

    expect(clinicApi.searchGuardians).toHaveBeenCalledWith({
      phone: '0100 000 0000',
      page: 1,
    });
    expect(clinicApi.familyRecord).toHaveBeenCalledWith('guardian-1');
    expect(directory.selected.value).toBe(record);
  });
});
