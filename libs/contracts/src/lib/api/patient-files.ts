import type { IsoInstant } from '../domain/temporal';

export interface PatientFile {
  id: string;
  childId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByMemberId: string;
  createdAt: IsoInstant;
}

export interface PatientFileDownload {
  url: string;
  expiresAt: IsoInstant;
}
