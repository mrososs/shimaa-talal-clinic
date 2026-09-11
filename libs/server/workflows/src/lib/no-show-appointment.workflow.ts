import { Injectable } from '@nestjs/common';
import { AppointmentService } from '@clinic/server-booking';
import { PaymentService } from '@clinic/server-payments';
import { DatabaseService, type SqlExecutor } from '@clinic/server-core';
import { AppointmentStatus, type Appointment } from '@clinic/contracts';

export interface NoShowAppointmentInput {
  clinicId: string;
  appointmentId: string;
  memberId: string;
}

/** Marks a visit absent and closes an uncollected cash promise atomically. */
@Injectable()
export class NoShowAppointmentWorkflow {
  constructor(
    private readonly database: DatabaseService,
    private readonly appointments: AppointmentService,
    private readonly payments: PaymentService,
  ) {}

  execute(
    input: NoShowAppointmentInput,
    db?: SqlExecutor,
  ): Promise<Appointment> {
    const run = async (tx: SqlExecutor): Promise<Appointment> => {
      const appointment = await this.appointments.transition(
        input.clinicId,
        input.appointmentId,
        AppointmentStatus.NoShow,
        { memberId: input.memberId },
        tx,
      );
      await this.payments.voidPendingCashForNoShow(
        input.clinicId,
        input.appointmentId,
        input.memberId,
        tx,
      );
      return appointment;
    };
    return db === undefined ? this.database.transaction(run) : run(db);
  }
}
