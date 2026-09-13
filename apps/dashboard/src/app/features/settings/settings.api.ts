import type { ApiClient } from '@clinic/api-client';
import type { ClinicAuditEvent, ClinicSettings } from '@clinic/contracts';
export function createSettingsApi(client: ApiClient) {
  return {
    read: (): Promise<ClinicSettings> => client.get('clinic/settings'),
    audit: (): Promise<ClinicAuditEvent[]> =>
      client.get('clinic/settings/audit'),
    profile: (v: unknown): Promise<ClinicSettings> =>
      client.patch('clinic/settings/profile', v),
    policies: (v: unknown): Promise<ClinicSettings> =>
      client.patch('clinic/settings/policies', v),
    tracking: (v: unknown): Promise<ClinicSettings> =>
      client.patch('clinic/settings/tracking', v),
    price: (key: string, v: unknown): Promise<ClinicSettings> =>
      client.put(`clinic/settings/prices/${key}`, v),
    template: (key: string, v: unknown): Promise<ClinicSettings> =>
      client.put(`clinic/settings/notifications/${key}`, v),
    schedule: (v: unknown): Promise<ClinicSettings> =>
      client.post('clinic/settings/schedules', v),
    closure: (v: unknown): Promise<ClinicSettings> =>
      client.post('clinic/settings/closures', v),
    team: (id: string, v: unknown): Promise<ClinicSettings> =>
      client.patch(`clinic/settings/team/${id}`, v),
  };
}
export type SettingsApi = ReturnType<typeof createSettingsApi>;
