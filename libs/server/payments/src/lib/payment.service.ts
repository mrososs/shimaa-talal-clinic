import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  SupabaseService,
  type QueryResultRow,
  type SqlExecutor,
} from '@clinic/server-core';
import type {
  ParentPaymentOption,
  ParentPaymentsView,
  PaymentMethod,
  PaymentReceiptDownload,
  PaymentRecord,
  PaymentStatus,
  RegisterParentPaymentInput,
  RegisterPaymentInput,
} from '@clinic/contracts';
import { PaymentsError, PaymentsErrorCode } from './payments.errors';

const BUCKET = 'clinic-payment-receipts';
const DOWNLOAD_TTL_SECONDS = 60;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export interface PaymentReceiptUpload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

type PaymentActor =
  | { memberId: string; guardianId?: never }
  | { guardianId: string; memberId?: never };

interface ParentPaymentSeed {
  appointmentId: string;
  childId: string;
  guardianId: string;
  amountMinor: number;
  currency: string;
}

interface PaymentRow extends QueryResultRow {
  id: string;
  appointment_id: string;
  child_id: string;
  guardian_id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount_minor: number;
  currency: string;
  receipt_object_path: string | null;
  receipt_file_name: string | null;
  recorded_by_member_id: string | null;
  recorded_by_guardian_id: string | null;
  decided_by_member_id: string | null;
  decision_note: string | null;
  paid_at: Date | null;
  refunded_at: Date | null;
  created_at: Date;
  storage_status: 'pending' | 'ready';
}

const COLUMNS = `id, appointment_id, child_id, guardian_id, method, status,
 amount_minor, currency, receipt_object_path, receipt_file_name,
 recorded_by_member_id, recorded_by_guardian_id, decided_by_member_id,
 decision_note, paid_at,
 refunded_at, created_at, storage_status`;

@Injectable()
export class PaymentService {
  constructor(
    private readonly database: DatabaseService,
    private readonly supabase: SupabaseService,
  ) {}

  async list(clinicId: string): Promise<PaymentRecord[]> {
    const result = await this.database.query<PaymentRow>(
      `select ${COLUMNS} from clinic.payments
       where clinic_id = $1 and storage_status = 'ready'
       order by created_at desc, id desc`,
      [clinicId],
    );
    return result.rows.map(toPayment);
  }

  async parentView(
    clinicId: string,
    guardianId: string,
  ): Promise<ParentPaymentsView> {
    const [payments, payable, clinic] = await Promise.all([
      this.database.query<PaymentRow>(
        `select ${COLUMNS} from clinic.payments
          where clinic_id = $1 and guardian_id = $2
            and storage_status = 'ready'
          order by created_at desc, id desc`,
        [clinicId, guardianId],
      ),
      this.database.query<{
        appointment_id: string;
        child_id: string;
        child_name: string;
        visit_type: string;
        appointment_status: string;
        window_start: Date;
        amount_minor: number;
        currency: string;
      }>(
        `select a.id as appointment_id, a.child_id,
                child.full_name as child_name, a.visit_type,
                a.status as appointment_status, a.window_start,
                price.amount_minor, price.currency
           from clinic.appointments a
           join clinic.children child
             on child.id = a.child_id and child.clinic_id = a.clinic_id
           join clinic.service_prices price
             on price.clinic_id = a.clinic_id
            and price.visit_type = a.visit_type and price.active
          where a.clinic_id = $1 and a.guardian_id = $2
            and a.status in ('requested', 'confirmed', 'checked_in')
            and not exists (
              select 1 from clinic.payments payment
               where payment.appointment_id = a.id
                 and payment.status in ('pending', 'paid')
            )
          order by a.window_start, a.id`,
        [clinicId, guardianId],
      ),
      this.database.query<{ instapay_handle: string | null }>(
        `select instapay_handle from clinic.clinics where id = $1`,
        [clinicId],
      ),
    ]);
    return {
      items: payments.rows.map(toPayment),
      payableAppointments: payable.rows.map(toParentPaymentOption),
      instapayHandle: clinic.rows[0]?.instapay_handle?.trim() || null,
    };
  }

  async registerCash(
    input: RegisterPaymentInput & { clinicId: string; memberId: string },
  ): Promise<PaymentRecord> {
    return this.database.transaction(async (tx) => {
      const inserted = await tx.query<PaymentRow>(
        `insert into clinic.payments
          (clinic_id, appointment_id, child_id, guardian_id, method, status,
           amount_minor, currency, idempotency_key, recorded_by_member_id, paid_at)
         values ($1,$2,$3,$4,'cash','paid',$5,$6,$7,$8,now())
         on conflict (clinic_id, idempotency_key) do nothing returning ${COLUMNS}`,
        [
          input.clinicId,
          input.appointmentId,
          input.childId,
          input.guardianId,
          input.amountMinor,
          input.currency,
          input.idempotencyKey,
          input.memberId,
        ],
      );
      const row =
        inserted.rows[0] ??
        (await this.byIdempotency(tx, input.clinicId, input.idempotencyKey));
      if (inserted.rows[0])
        await event(
          tx,
          input.clinicId,
          row.id,
          'cash_registered',
          null,
          'paid',
          { memberId: input.memberId },
          null,
        );
      return toPayment(row);
    });
  }

  async registerParentCash(
    clinicId: string,
    guardianId: string,
    input: RegisterParentPaymentInput,
  ): Promise<PaymentRecord> {
    return this.database.transaction(async (tx) => {
      const seed = await this.parentPaymentSeed(
        clinicId,
        guardianId,
        input.appointmentId,
        tx,
      );
      const active = await this.findActiveForAppointment(
        tx,
        clinicId,
        guardianId,
        seed.appointmentId,
      );
      if (active) return active;
      const inserted = await tx.query<PaymentRow>(
        `insert into clinic.payments
          (clinic_id, appointment_id, child_id, guardian_id, method, status,
           amount_minor, currency, idempotency_key,
           recorded_by_guardian_id)
         values ($1,$2,$3,$4,'cash','pending',$5,$6,$7,$4)
         on conflict do nothing
         returning ${COLUMNS}`,
        [
          clinicId,
          seed.appointmentId,
          seed.childId,
          seed.guardianId,
          seed.amountMinor,
          seed.currency,
          input.idempotencyKey,
        ],
      );
      const row = inserted.rows[0];
      if (!row) {
        const raced = await this.findActiveForAppointment(
          tx,
          clinicId,
          guardianId,
          seed.appointmentId,
        );
        if (raced) return raced;
        return toPayment(
          await this.byIdempotency(tx, clinicId, input.idempotencyKey),
        );
      }
      if (inserted.rows[0]) {
        await event(
          tx,
          clinicId,
          row.id,
          'cash_selected',
          null,
          'pending',
          { guardianId },
          null,
        );
      }
      return toPayment(row);
    });
  }

  async registerInstapay(
    input: RegisterPaymentInput & {
      clinicId: string;
      memberId: string;
      file?: PaymentReceiptUpload;
    },
  ): Promise<PaymentRecord> {
    return this.registerInstapayForActor(input, { memberId: input.memberId });
  }

  async registerParentInstapay(
    clinicId: string,
    guardianId: string,
    input: RegisterParentPaymentInput & { file?: PaymentReceiptUpload },
  ): Promise<PaymentRecord> {
    const seed = await this.parentPaymentSeed(
      clinicId,
      guardianId,
      input.appointmentId,
      this.database,
    );
    const active = await this.findActiveForAppointment(
      this.database,
      clinicId,
      guardianId,
      seed.appointmentId,
    );
    if (active) return active;
    if (
      await this.findProcessingForAppointment(
        this.database,
        clinicId,
        guardianId,
        seed.appointmentId,
      )
    ) {
      throw paymentProcessing();
    }
    await this.requireParentInstapay(clinicId);
    return this.registerInstapayForActor(
      {
        ...seed,
        clinicId,
        idempotencyKey: input.idempotencyKey,
        file: input.file,
      },
      { guardianId },
    );
  }

  private async requireParentInstapay(clinicId: string): Promise<void> {
    const configured = await this.database.query<{ configured: boolean }>(
      `select nullif(btrim(instapay_handle), '') is not null as configured
         from clinic.clinics where id = $1`,
      [clinicId],
    );
    if (configured.rows[0]?.configured) return;
    throw new PaymentsError(
      PaymentsErrorCode.InstapayUnavailable,
      'InstaPay is not configured for this clinic.',
    );
  }

  private async registerInstapayForActor(
    input: RegisterPaymentInput & {
      clinicId: string;
      file?: PaymentReceiptUpload;
    },
    actor: PaymentActor,
  ): Promise<PaymentRecord> {
    const file = validFile(input.file);
    const existing = await this.findByIdempotency(
      input.clinicId,
      input.idempotencyKey,
    );
    if (existing) return existing;
    const id = randomUUID();
    const objectPath = `${input.clinicId}/${input.appointmentId}/${id}${safeExtension(file.originalname, file.mimetype)}`;
    try {
      await this.database.query(
        `insert into clinic.payments
          (id,clinic_id,appointment_id,child_id,guardian_id,method,status,amount_minor,currency,idempotency_key,
           receipt_object_path,receipt_file_name,receipt_mime_type,
           receipt_size_bytes,storage_status,recorded_by_member_id,
           recorded_by_guardian_id)
         values ($1,$2,$3,$4,$5,'instapay','pending',$6,$7,$8,$9,$10,$11,$12,
                 'pending',$13,$14)`,
        [
          id,
          input.clinicId,
          input.appointmentId,
          input.childId,
          input.guardianId,
          input.amountMinor,
          input.currency,
          input.idempotencyKey,
          objectPath,
          cleanFileName(file.originalname),
          file.mimetype,
          file.size,
          actor.memberId ?? null,
          actor.guardianId ?? null,
        ],
      );
    } catch (error) {
      const raced = await this.findByIdempotency(
        input.clinicId,
        input.idempotencyKey,
      );
      if (raced) return raced;
      if (
        await this.findProcessingForAppointment(
          this.database,
          input.clinicId,
          input.guardianId,
          input.appointmentId,
        )
      ) {
        throw paymentProcessing();
      }
      throw error;
    }
    const uploaded = await this.supabase.admin.storage
      .from(BUCKET)
      .upload(objectPath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
    if (uploaded.error) {
      await this.database
        .query(
          `delete from clinic.payments where id=$1 and clinic_id=$2 and storage_status='pending'`,
          [id, input.clinicId],
        )
        .catch(() => undefined);
      throw storageFailed(uploaded.error);
    }
    try {
      return await this.database.transaction(async (tx) => {
        const ready = await tx.query<PaymentRow>(
          `update clinic.payments set storage_status='ready' where id=$1 and clinic_id=$2 and storage_status='pending' returning ${COLUMNS}`,
          [id, input.clinicId],
        );
        const row = ready.rows[0];
        if (!row) throw storageFailed();
        await event(
          tx,
          input.clinicId,
          id,
          'receipt_uploaded',
          null,
          'pending',
          actor,
          null,
        );
        return toPayment(row);
      });
    } catch (error) {
      await this.supabase.admin.storage.from(BUCKET).remove([objectPath]);
      throw error;
    }
  }

  approve(
    clinicId: string,
    paymentId: string,
    memberId: string,
    note: string | null,
  ): Promise<PaymentRecord> {
    return this.transition(
      clinicId,
      paymentId,
      memberId,
      'pending',
      'paid',
      'approved',
      note,
    );
  }
  reject(
    clinicId: string,
    paymentId: string,
    memberId: string,
    note: string | null,
  ): Promise<PaymentRecord> {
    return this.transition(
      clinicId,
      paymentId,
      memberId,
      'pending',
      'failed',
      'rejected',
      note,
    );
  }
  refund(
    clinicId: string,
    paymentId: string,
    memberId: string,
    note: string | null,
  ): Promise<PaymentRecord> {
    return this.transition(
      clinicId,
      paymentId,
      memberId,
      'paid',
      'refunded',
      'refunded',
      note,
    );
  }

  async receipt(
    clinicId: string,
    paymentId: string,
  ): Promise<PaymentReceiptDownload> {
    const result = await this.database.query<PaymentRow>(
      `select ${COLUMNS} from clinic.payments where id=$1 and clinic_id=$2 and method='instapay' and storage_status='ready'`,
      [paymentId, clinicId],
    );
    const row = result.rows[0];
    if (!row?.receipt_object_path) throw notFound();
    const signed = await this.supabase.admin.storage
      .from(BUCKET)
      .createSignedUrl(row.receipt_object_path, DOWNLOAD_TTL_SECONDS, {
        download: row.receipt_file_name ?? 'receipt',
      });
    if (signed.error || !signed.data?.signedUrl)
      throw storageFailed(signed.error);
    return {
      url: signed.data.signedUrl,
      expiresAt: new Date(
        Date.now() + DOWNLOAD_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  }

  private async transition(
    clinicId: string,
    id: string,
    memberId: string,
    from: PaymentStatus,
    to: PaymentStatus,
    kind: string,
    note: string | null,
  ): Promise<PaymentRecord> {
    return this.database.transaction(async (tx) => {
      const locked = await tx.query<PaymentRow>(
        `select ${COLUMNS} from clinic.payments where id=$1 and clinic_id=$2 and storage_status='ready' for update`,
        [id, clinicId],
      );
      const current = locked.rows[0];
      if (!current) throw notFound();
      if (current.status === to) return toPayment(current);
      if (current.status !== from)
        throw new PaymentsError(
          PaymentsErrorCode.InvalidTransition,
          `Payment cannot move from ${current.status} to ${to}.`,
        );
      const updated = await tx.query<PaymentRow>(
        `update clinic.payments set status=$3, decided_by_member_id=$4, decision_note=$5,
          paid_at=case when $3='paid' then now() else paid_at end,
          refunded_at=case when $3='refunded' then now() else refunded_at end
         where id=$1 and clinic_id=$2 returning ${COLUMNS}`,
        [id, clinicId, to, memberId, note],
      );
      await event(tx, clinicId, id, kind, from, to, { memberId }, note);
      const row = updated.rows[0];
      if (!row) throw notFound();
      return toPayment(row);
    });
  }

  private async byIdempotency(
    db: SqlExecutor,
    clinicId: string,
    key: string,
  ): Promise<PaymentRow> {
    const result = await db.query<PaymentRow>(
      `select ${COLUMNS} from clinic.payments where clinic_id=$1 and idempotency_key=$2 and storage_status='ready'`,
      [clinicId, key],
    );
    if (!result.rows[0])
      throw new PaymentsError(
        PaymentsErrorCode.InvalidTransition,
        'An identical payment is still being processed.',
      );
    return result.rows[0];
  }

  private async parentPaymentSeed(
    clinicId: string,
    guardianId: string,
    appointmentId: string,
    db: SqlExecutor,
  ): Promise<ParentPaymentSeed> {
    const result = await db.query<{
      appointment_id: string;
      child_id: string;
      guardian_id: string;
      amount_minor: number;
      currency: string;
    }>(
      `select a.id as appointment_id, a.child_id, a.guardian_id,
              price.amount_minor, price.currency
         from clinic.appointments a
         join clinic.service_prices price
           on price.clinic_id = a.clinic_id
          and price.visit_type = a.visit_type
          and price.active
        where a.id = $1 and a.clinic_id = $2 and a.guardian_id = $3
          and a.status in ('requested', 'confirmed', 'checked_in')`,
      [appointmentId, clinicId, guardianId],
    );
    const row = result.rows[0];
    if (!row) throw notFound();
    return {
      appointmentId: row.appointment_id,
      childId: row.child_id,
      guardianId: row.guardian_id,
      amountMinor: row.amount_minor,
      currency: row.currency,
    };
  }

  private async findActiveForAppointment(
    db: SqlExecutor,
    clinicId: string,
    guardianId: string,
    appointmentId: string,
  ): Promise<PaymentRecord | null> {
    const result = await db.query<PaymentRow>(
      `select ${COLUMNS} from clinic.payments
        where clinic_id = $1 and guardian_id = $2 and appointment_id = $3
          and status in ('pending', 'paid') and storage_status = 'ready'
        order by created_at desc limit 1`,
      [clinicId, guardianId, appointmentId],
    );
    return result.rows[0] ? toPayment(result.rows[0]) : null;
  }

  private async findByIdempotency(
    clinicId: string,
    key: string,
  ): Promise<PaymentRecord | null> {
    const result = await this.database.query<PaymentRow>(
      `select ${COLUMNS} from clinic.payments where clinic_id=$1 and idempotency_key=$2 and storage_status='ready'`,
      [clinicId, key],
    );
    return result.rows[0] ? toPayment(result.rows[0]) : null;
  }

  private async findProcessingForAppointment(
    db: SqlExecutor,
    clinicId: string,
    guardianId: string,
    appointmentId: string,
  ): Promise<boolean> {
    const result = await db.query(
      `select 1 from clinic.payments
        where clinic_id = $1 and guardian_id = $2 and appointment_id = $3
          and status in ('pending', 'paid') and storage_status = 'pending'
        limit 1`,
      [clinicId, guardianId, appointmentId],
    );
    return result.rows.length > 0;
  }
}

async function event(
  db: SqlExecutor,
  clinicId: string,
  paymentId: string,
  kind: string,
  from: string | null,
  to: string,
  actor: PaymentActor,
  note: string | null,
): Promise<void> {
  await db.query(
    `insert into clinic.payment_events
       (clinic_id,payment_id,event_type,from_status,to_status,
        actor_member_id,actor_guardian_id,note)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      clinicId,
      paymentId,
      kind,
      from,
      to,
      actor.memberId ?? null,
      actor.guardianId ?? null,
      note,
    ],
  );
}
function toPayment(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    childId: row.child_id,
    guardianId: row.guardian_id,
    method: row.method,
    status: row.status,
    amountMinor: row.amount_minor,
    currency: row.currency,
    receiptFileName: row.receipt_file_name,
    recordedByMemberId: row.recorded_by_member_id,
    recordedByGuardianId: row.recorded_by_guardian_id,
    decidedByMemberId: row.decided_by_member_id,
    decisionNote: row.decision_note,
    paidAt: row.paid_at?.toISOString() ?? null,
    refundedAt: row.refunded_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}
function toParentPaymentOption(row: {
  appointment_id: string;
  child_id: string;
  child_name: string;
  visit_type: string;
  appointment_status: string;
  window_start: Date;
  amount_minor: number;
  currency: string;
}): ParentPaymentOption {
  return {
    appointmentId: row.appointment_id,
    childId: row.child_id,
    childName: row.child_name,
    visitType: row.visit_type,
    appointmentStatus: row.appointment_status,
    windowStart: row.window_start.toISOString(),
    amountMinor: row.amount_minor,
    currency: row.currency,
  };
}
function notFound() {
  return new PaymentsError(
    PaymentsErrorCode.NotFound,
    'Payment was not found.',
  );
}
function storageFailed(cause?: unknown) {
  return new PaymentsError(
    PaymentsErrorCode.StorageFailed,
    'Payment receipt storage is temporarily unavailable.',
    cause,
  );
}
function paymentProcessing() {
  return new PaymentsError(
    PaymentsErrorCode.InvalidTransition,
    'A payment for this appointment is still being processed.',
  );
}
function validFile(file?: PaymentReceiptUpload): PaymentReceiptUpload {
  if (
    !file ||
    file.size < 1 ||
    file.size > MAX_FILE_SIZE ||
    !ALLOWED_TYPES.has(file.mimetype) ||
    !signature(file.buffer, file.mimetype)
  )
    throw new PaymentsError(
      PaymentsErrorCode.InvalidReceipt,
      'Upload a PDF, JPG, PNG or WebP receipt no larger than 5 MB.',
    );
  return file;
}
function signature(b: Buffer, m: string) {
  if (m === 'application/pdf')
    return b.subarray(0, 5).toString('ascii') === '%PDF-';
  if (m === 'image/jpeg')
    return b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (m === 'image/png')
    return b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  return (
    m === 'image/webp' &&
    b.subarray(0, 4).toString('ascii') === 'RIFF' &&
    b.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}
function cleanFileName(name: string) {
  const withoutControls = Array.from(name, (c) =>
    c.charCodeAt(0) < 32 ? '_' : c,
  ).join('');
  return (withoutControls.replace(/[\\/]/g, '_').trim() || 'receipt').slice(
    0,
    255,
  );
}
function safeExtension(name: string, mime: string) {
  const expected: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  };
  const supplied = extname(name).toLowerCase();
  return supplied === '.jpeg' && mime === 'image/jpeg'
    ? '.jpg'
    : supplied === expected[mime]
      ? supplied
      : expected[mime];
}
