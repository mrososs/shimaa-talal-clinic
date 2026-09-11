import { Injectable } from '@nestjs/common';
import {
  AppointmentService,
  BookingError,
  BookingErrorCode,
  type TransitionActor,
} from '@clinic/server-booking';
import {
  PaymentService,
  PaymentsError,
  PaymentsErrorCode,
} from '@clinic/server-payments';
import { DatabaseService, type SqlExecutor } from '@clinic/server-core';
import {
  AppointmentStatus,
  PaymentStatus,
  type Appointment,
} from '@clinic/contracts';

type RescheduleActor =
  | { memberId: string; guardianId?: never; authUserId?: never }
  | { guardianId: string; authUserId: string; memberId?: never };

export interface RescheduleAppointmentInput {
  clinicId: string;
  appointmentId: string;
  target: { sessionId: string; windowStart: string };
  actor: RescheduleActor;
}

/** Reschedules Booking and carries any live payment allocation in one commit. */
@Injectable()
export class RescheduleAppointmentWorkflow {
  constructor(
    private readonly database: DatabaseService,
    private readonly appointments: AppointmentService,
    private readonly payments: PaymentService,
  ) {}

  execute(
    input: RescheduleAppointmentInput,
    db?: SqlExecutor,
  ): Promise<Appointment> {
    const run = async (tx: SqlExecutor): Promise<Appointment> => {
      const original = await this.appointments.findByIdForUpdate(
        input.clinicId,
        input.appointmentId,
        tx,
      );
      if (original === null) {
        // Let Booking preserve its generic not-found contract.
        return this.appointments.reschedule(
          input.clinicId,
          input.appointmentId,
          input.target,
          bookingActor(input.actor),
          tx,
        );
      }
      if (
        'guardianId' in input.actor &&
        original.guardianId !== input.actor.guardianId
      ) {
        throw new BookingError(
          BookingErrorCode.AppointmentNotFound,
          'No such appointment.',
        );
      }

      const existing = await this.appointments.findLiveRescheduledFrom(
        input.clinicId,
        input.appointmentId,
        tx,
      );
      if (existing !== null) return existing;

      const payment = await this.payments.findActiveForTransfer(
        input.clinicId,
        original.guardianId,
        original.id,
        tx,
      );
      if (
        original.status === AppointmentStatus.NoShow &&
        payment?.status !== PaymentStatus.Paid
      ) {
        throw new PaymentsError(
          PaymentsErrorCode.MissedRescheduleRequiresPaid,
          'A missed appointment can only retain a new slot after payment was collected.',
        );
      }

      const replacement = await this.appointments.reschedule(
        input.clinicId,
        input.appointmentId,
        input.target,
        bookingActor(input.actor),
        tx,
      );
      if (payment !== null) {
        await this.payments.transferToAppointment(
          input.clinicId,
          payment,
          original.id,
          replacement.id,
          paymentActor(input.actor),
          tx,
        );
      }
      return replacement;
    };

    return db === undefined ? this.database.transaction(run) : run(db);
  }
}

function bookingActor(actor: RescheduleActor): TransitionActor {
  return 'memberId' in actor
    ? { memberId: actor.memberId }
    : { authUserId: actor.authUserId };
}

function paymentActor(
  actor: RescheduleActor,
): { memberId: string } | { guardianId: string } {
  const memberId = actor.memberId;
  return memberId !== undefined
    ? { memberId }
    : { guardianId: actor.guardianId };
}
