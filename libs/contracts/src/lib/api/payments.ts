export type PaymentMethod = 'cash' | 'instapay';
import type { PaymentStatus } from '../domain/payment-status';

export interface PaymentRecord {
  id: string;
  appointmentId: string;
  childId: string;
  guardianId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  receiptFileName: string | null;
  recordedByMemberId: string | null;
  recordedByGuardianId: string | null;
  decidedByMemberId: string | null;
  decisionNote: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  createdAt: string;
}

export interface ClinicPayment extends PaymentRecord {
  childName: string;
  guardianName: string;
}

export interface PaymentsDashboard {
  items: ClinicPayment[];
  totals: {
    collectedMinor: number;
    pendingMinor: number;
    refundedMinor: number;
  };
}

export interface RegisterPaymentInput {
  appointmentId: string;
  childId: string;
  guardianId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
}

/** Guardian input. Identity and price are deliberately absent and server-owned. */
export interface RegisterParentPaymentInput {
  appointmentId: string;
  idempotencyKey: string;
}

export interface ParentPaymentOption {
  appointmentId: string;
  childId: string;
  childName: string;
  visitType: string;
  appointmentStatus: string;
  windowStart: string;
  amountMinor: number;
  currency: string;
}

/** Everything the guardian payment screen needs, with prices owned by API. */
export interface ParentPaymentsView {
  items: PaymentRecord[];
  payableAppointments: ParentPaymentOption[];
  /** Server-owned destination shown before a guardian uploads a receipt. */
  instapayHandle: string | null;
}

export interface PaymentDecisionInput {
  note?: string;
}

export interface PaymentReceiptDownload {
  url: string;
  expiresAt: string;
}

export interface ClinicReport {
  from: string;
  to: string;
  appointments: {
    total: number;
    completed: number;
    noShow: number;
    byStatus: Record<string, number>;
    byVisitType: Record<string, number>;
    bySource: { online: number; clinic: number };
  };
  queue: {
    averageWaitMinutes: number | null;
    averageServiceMinutes: number | null;
    peakHours: Array<{ hour: number; count: number }>;
  };
  weeklyActivity: Array<{
    date: string;
    appointments: number;
    completed: number;
  }>;
  financial: null | {
    collectedMinor: number;
    pendingMinor: number;
    refundedMinor: number;
    currency: string;
  };
}

export interface ReportExport {
  fileName: string;
  mimeType: 'text/csv;charset=utf-8';
  content: string;
}
