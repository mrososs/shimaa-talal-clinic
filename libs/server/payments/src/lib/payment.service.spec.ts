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

  it('voids an uncollected cash promise on no-show without a refund', async () => {
    const payment = await service().registerParentCash(
      fx.clinicId,
      fx.guardianId,
      {
        appointmentId: fx.appointmentId,
        idempotencyKey: '68b02484-4bcc-4f72-9c85-3f540633ab0a',
      },
    );
    const result = await fx.db.database.transaction((tx) =>
      service().voidPendingCashForNoShow(
        fx.clinicId,
        fx.appointmentId,
        fx.doctorMemberId,
        tx,
      ),
    );

    expect(result).toMatchObject({ id: payment.id, status: 'failed' });
    const restored = await fx.db.database.transaction((tx) =>
      service().restoreCashAfterRequeue(
        fx.clinicId,
        fx.appointmentId,
        fx.doctorMemberId,
        tx,
      ),
    );
    expect(restored).toMatchObject({ id: payment.id, status: 'pending' });
    const events = await fx.db.database.query<{ event_type: string }>(
      `select event_type from clinic.payment_events
        where payment_id = $1 order by created_at, id`,
      [payment.id],
    );
    expect(events.rows.map((row) => row.event_type)).toEqual([
      'cash_selected',
      'voided_no_show',
      'restored_after_requeue',
    ]);
  });

  it('moves a paid credit and records both appointment ids', async () => {
    const payment = await service().registerCash({
      clinicId: fx.clinicId,
      memberId: fx.doctorMemberId,
      appointmentId: fx.appointmentId,
      childId: fx.childId,
      guardianId: fx.guardianId,
      amountMinor: 45000,
      currency: 'EGP',
      idempotencyKey: '6a3c3c46-1591-4638-a3aa-50205a0939ed',
    });
    await fx.db.database.query(
      `update clinic.appointments
          set status='cancelled',cancelled_at=now(),cancelled_by='clinic'
        where id=$1`,
      [fx.appointmentId],
    );
    const replacement = await fx.db.database.query<{ id: string }>(
      `insert into clinic.appointments
        (clinic_id,session_id,child_id,guardian_id,window_start,window_end,
         seat_no,visit_type,status,rescheduled_from_appointment_id)
       select clinic_id,session_id,child_id,guardian_id,
              window_start + interval '30 minutes',
              window_end + interval '30 minutes',2,visit_type,'confirmed',id
         from clinic.appointments where id=$1 returning id`,
      [fx.appointmentId],
    );

    await fx.db.database.transaction(async (tx) => {
      const active = await service().findActiveForTransfer(
        fx.clinicId,
        fx.guardianId,
        fx.appointmentId,
        tx,
      );
      expect(active?.id).toBe(payment.id);
      await service().transferToAppointment(
        fx.clinicId,
        active!,
        fx.appointmentId,
        replacement.rows[0].id,
        { guardianId: fx.guardianId },
        tx,
      );
    });

    const result = await fx.db.database.query<{
      appointment_id: string;
      event_type: string;
      from_appointment_id: string;
      to_appointment_id: string;
    }>(
      `select payment.appointment_id,event.event_type,
              event.from_appointment_id,event.to_appointment_id
         from clinic.payments payment
         join clinic.payment_events event on event.payment_id=payment.id
        where payment.id=$1 and event.event_type='transferred'`,
      [payment.id],
    );
    expect(result.rows[0]).toEqual({
      appointment_id: replacement.rows[0].id,
      event_type: 'transferred',
      from_appointment_id: fx.appointmentId,
      to_appointment_id: replacement.rows[0].id,
    });
    await clearPayments(fx.db.database, fx.clinicId);
    await fx.db.database.query(
      `delete from clinic.appointment_events where appointment_id=$1`,
      [replacement.rows[0].id],
    );
    await fx.db.database.query(`delete from clinic.appointments where id=$1`, [
      replacement.rows[0].id,
    ]);
    await fx.db.database.query(
      `update clinic.appointments
          set status='confirmed',cancelled_at=null,cancelled_by=null
        where id=$1`,
      [fx.appointmentId],
    );
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
