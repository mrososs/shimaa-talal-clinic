import type { SupabaseService } from '@clinic/server-core';
import { PaymentService } from './payment.service';
import { PaymentsErrorCode } from './payments.errors';
import {
  clearPayments,
  describePaymentsWithDatabase,
} from './payments.fixture';

describePaymentsWithDatabase((fx) => {
  const storage = {
    upload: jest.fn().mockResolvedValue({ data: {}, error: null }),
    remove: jest.fn().mockResolvedValue({ data: {}, error: null }),
    createSignedUrl: jest.fn(),
  };
  const supabase = {
    admin: { storage: { from: jest.fn(() => storage) } },
  } as unknown as SupabaseService;
  const service = () => new PaymentService(fx.db.database, supabase);

  afterEach(async () => {
    await clearPayments(fx.db.database, fx.clinicId);
    jest.clearAllMocks();
  });

  it('returns server-priced payable appointments without exposing another guardian', async () => {
    const owner = await service().parentView(fx.clinicId, fx.guardianId);
    const stranger = await service().parentView(
      fx.clinicId,
      fx.otherGuardianId,
    );

    expect(owner.items).toEqual([]);
    expect(owner.payableAppointments).toEqual([
      expect.objectContaining({
        appointmentId: fx.appointmentId,
        childId: fx.childId,
        childName: 'Payment Child',
        amountMinor: 45000,
        currency: 'EGP',
      }),
    ]);
    expect(owner.instapayHandle).toBe('payments.fixture@instapay');
    expect(stranger).toEqual({
      items: [],
      payableAppointments: [],
      instapayHandle: 'payments.fixture@instapay',
    });
  });

  it('registers cash as pending with guardian-owned audit identity', async () => {
    const payment = await service().registerParentCash(
      fx.clinicId,
      fx.guardianId,
      {
        appointmentId: fx.appointmentId,
        idempotencyKey: '3aee2537-ea40-4caa-a211-56f2f3957350',
      },
    );

    expect(payment).toMatchObject({
      childId: fx.childId,
      guardianId: fx.guardianId,
      method: 'cash',
      status: 'pending',
      amountMinor: 45000,
      currency: 'EGP',
      recordedByMemberId: null,
      recordedByGuardianId: fx.guardianId,
    });
    const event = await fx.db.database.query<{
      event_type: string;
      actor_member_id: string | null;
      actor_guardian_id: string | null;
    }>(
      `select event_type, actor_member_id, actor_guardian_id
         from clinic.payment_events where payment_id = $1`,
      [payment.id],
    );
    expect(event.rows).toEqual([
      {
        event_type: 'cash_selected',
        actor_member_id: null,
        actor_guardian_id: fx.guardianId,
      },
    ]);
  });

  it('makes a real concurrent retry one payment and one event', async () => {
    const input = {
      appointmentId: fx.appointmentId,
      idempotencyKey: '6b87c0ce-d3a9-453e-9d34-540029f164c1',
    };
    const [first, second] = await Promise.all([
      service().registerParentCash(fx.clinicId, fx.guardianId, input),
      service().registerParentCash(fx.clinicId, fx.guardianId, input),
    ]);
    expect(second.id).toBe(first.id);
    const counts = await fx.db.database.query<{
      payments: string;
      events: string;
    }>(
      `select
         (select count(*) from clinic.payments where appointment_id = $1)::text as payments,
         (select count(*) from clinic.payment_events where payment_id = $2)::text as events`,
      [fx.appointmentId, first.id],
    );
    expect(counts.rows[0]).toEqual({ payments: '1', events: '1' });
  });

  it('rejects a guardian who does not own the appointment', async () => {
    await expect(
      service().registerParentCash(fx.clinicId, fx.otherGuardianId, {
        appointmentId: fx.appointmentId,
        idempotencyKey: 'be7f96f3-8c8e-46bc-8138-dda6db3d45aa',
      }),
    ).rejects.toMatchObject({ code: PaymentsErrorCode.NotFound });
  });

  it('uploads a private receipt and records the guardian as actor', async () => {
    const payment = await service().registerParentInstapay(
      fx.clinicId,
      fx.guardianId,
      {
        appointmentId: fx.appointmentId,
        idempotencyKey: '2546db7e-e36c-4d52-8968-67362e20ace3',
        file: {
          originalname: 'receipt.pdf',
          mimetype: 'application/pdf',
          size: 9,
          buffer: Buffer.from('%PDF-test'),
        },
      },
    );

    expect(payment).toMatchObject({
      method: 'instapay',
      status: 'pending',
      receiptFileName: 'receipt.pdf',
      recordedByGuardianId: fx.guardianId,
    });
    expect(storage.upload).toHaveBeenCalledTimes(1);
    const event = await fx.db.database.query<{
      event_type: string;
      actor_guardian_id: string;
    }>(
      `select event_type, actor_guardian_id from clinic.payment_events
        where payment_id = $1`,
      [payment.id],
    );
    expect(event.rows).toEqual([
      { event_type: 'receipt_uploaded', actor_guardian_id: fx.guardianId },
    ]);
  });

  it('keeps a completed InstaPay retry idempotent after configuration is removed', async () => {
    const input = {
      appointmentId: fx.appointmentId,
      idempotencyKey: '89921a80-d4f1-4cb2-948a-12fccf32d239',
      file: {
        originalname: 'receipt.pdf',
        mimetype: 'application/pdf',
        size: 9,
        buffer: Buffer.from('%PDF-test'),
      },
    };
    const first = await service().registerParentInstapay(
      fx.clinicId,
      fx.guardianId,
      input,
    );
    await fx.db.database.query(
      `update clinic.clinics set instapay_handle = null where id = $1`,
      [fx.clinicId],
    );
    try {
      const retry = await service().registerParentInstapay(
        fx.clinicId,
        fx.guardianId,
        input,
      );
      expect(retry.id).toBe(first.id);
      expect(storage.upload).toHaveBeenCalledTimes(1);
    } finally {
      await fx.db.database.query(
        `update clinic.clinics set instapay_handle = 'payments.fixture@instapay'
          where id = $1`,
        [fx.clinicId],
      );
    }
  });

  it('rejects a parent InstaPay upload when the clinic has no destination', async () => {
    await fx.db.database.query(
      `update clinic.clinics set instapay_handle = null where id = $1`,
      [fx.clinicId],
    );
    try {
      await expect(
        service().registerParentInstapay(fx.clinicId, fx.guardianId, {
          appointmentId: fx.appointmentId,
          idempotencyKey: 'cd3bf876-83ca-4ad9-8661-1690182bf13b',
          file: {
            originalname: 'receipt.pdf',
            mimetype: 'application/pdf',
            size: 9,
            buffer: Buffer.from('%PDF-test'),
          },
        }),
      ).rejects.toMatchObject({
        code: PaymentsErrorCode.InstapayUnavailable,
      });
      expect(storage.upload).not.toHaveBeenCalled();
    } finally {
      await fx.db.database.query(
        `update clinic.clinics set instapay_handle = 'payments.fixture@instapay'
          where id = $1`,
        [fx.clinicId],
      );
    }
  });
});
