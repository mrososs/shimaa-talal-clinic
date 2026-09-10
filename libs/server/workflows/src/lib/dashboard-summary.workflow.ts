import { Injectable } from '@nestjs/common';
import { ClinicSessionService } from '@clinic/server-clinic';
import {
  AppointmentStatus,
  QueueStatus,
  type DashboardSummary,
} from '@clinic/contracts';
import { ClinicQueueBoardWorkflow } from './clinic-queue-board.workflow';
import { StaffAppointmentsWorkflow } from './staff-appointments.workflow';

export interface DashboardSummaryInput {
  clinicId: string;
  date: string;
}

/** Composes the operational landing page without coupling its source domains. */
@Injectable()
export class DashboardSummaryWorkflow {
  constructor(
    private readonly appointments: StaffAppointmentsWorkflow,
    private readonly sessions: ClinicSessionService,
    private readonly boards: ClinicQueueBoardWorkflow,
  ) {}

  async execute(input: DashboardSummaryInput): Promise<DashboardSummary> {
    const [appointments, sessions] = await Promise.all([
      this.appointments.execute(input),
      this.sessions.findByDate(input.clinicId, input.date),
    ]);
    const boards = await Promise.all(
      sessions.map((session) => this.boards.execute(session)),
    );
    const entries = boards.flatMap((board) => board.entries);

    return {
      date: input.date,
      appointments: {
        total: appointments.length,
        requested: count(appointments, AppointmentStatus.Requested),
        confirmed: count(appointments, AppointmentStatus.Confirmed),
        checkedIn: count(appointments, AppointmentStatus.CheckedIn),
        completed: count(appointments, AppointmentStatus.Completed),
        cancelled: count(appointments, AppointmentStatus.Cancelled),
        noShow: count(appointments, AppointmentStatus.NoShow),
      },
      queue: {
        waiting: count(entries, QueueStatus.Waiting),
        called: count(entries, QueueStatus.Called),
        inService: count(entries, QueueStatus.InService),
        done: count(entries, QueueStatus.Done),
        missed: count(entries, QueueStatus.Missed),
      },
      pendingRequests: appointments.filter(
        (appointment) => appointment.status === AppointmentStatus.Requested,
      ),
      nowServing:
        entries.find((entry) => entry.status === QueueStatus.InService) ?? null,
      nextWaiting: entries
        .filter((entry) => entry.status === QueueStatus.Waiting)
        .slice(0, 4),
    };
  }
}

function count<T extends { status: string }>(
  rows: T[],
  status: string,
): number {
  return rows.filter((row) => row.status === status).length;
}
