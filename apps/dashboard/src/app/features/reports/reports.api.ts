import type { ApiClient } from '@clinic/api-client';
import type { ClinicReport, ReportExport } from '@clinic/contracts';
export function createReportsApi(client: ApiClient) {
  return {
    read: (from: string, to: string): Promise<ClinicReport> =>
      client.get('clinic/reports', { query: { from, to } }),
    export: (from: string, to: string): Promise<ReportExport> =>
      client.get('clinic/reports/export', { query: { from, to } }),
  };
}
export type ReportsApi = ReturnType<typeof createReportsApi>;
