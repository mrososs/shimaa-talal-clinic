import {
  AppointmentStatus,
  QueueStatus,
  type AppointmentListItem,
  type ClinicSession,
  type QueueBoard,
  type QueueBoardEntry,
} from '@clinic/contracts';
import type { ClinicSessionService } from '@clinic/server-clinic';
import { DashboardSummaryWorkflow } from './dashboard-summary.workflow';
import type { ClinicQueueBoardWorkflow } from './clinic-queue-board.workflow';
import type { StaffAppointmentsWorkflow } from './staff-appointments.workflow';

describe('DashboardSummaryWorkflow', () => {
  it('aggregates real appointment and queue reads for one clinic day', async () => {
    const requested = appointment('requested', AppointmentStatus.Requested);
    const completed = appointment('completed', AppointmentStatus.Completed);
    const session = { id: 'session-1' } as ClinicSession;
    const inService = entry('serving', QueueStatus.InService);
    const waiting = entry('waiting', QueueStatus.Waiting);

    const appointments = {
      execute: jest.fn().mockResolvedValue([requested, completed]),
    };
    const sessions = {
      findByDate: jest.fn().mockResolvedValue([session]),
    };
    const boards = {
      execute: jest.fn().mockResolvedValue({
        session,
        revision: 2,
        entries: [inService, waiting],
        notArrived: [],
      } satisfies QueueBoard),
    };

    const workflow = new DashboardSummaryWorkflow(
      appointments as unknown as StaffAppointmentsWorkflow,
      sessions as unknown as ClinicSessionService,
      boards as unknown as ClinicQueueBoardWorkflow,
    );

    await expect(
      workflow.execute({ clinicId: 'clinic-1', date: '2026-09-08' }),
    ).resolves.toEqual(
      expect.objectContaining({
        date: '2026-09-08',
        appointments: expect.objectContaining({
          total: 2,
          requested: 1,
          completed: 1,
        }),
        queue: expect.objectContaining({ waiting: 1, inService: 1 }),
        pendingRequests: [requested],
        nowServing: inService,
        nextWaiting: [waiting],
      }),
    );
  });
});

function appointment(
  id: string,
  status: AppointmentListItem['status'],
): AppointmentListItem {
  return { id, status } as AppointmentListItem;
}

function entry(id: string, status: QueueBoardEntry['status']): QueueBoardEntry {
  return { id, status } as QueueBoardEntry;
}
