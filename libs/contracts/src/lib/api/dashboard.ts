import type { AppointmentListItem } from '../domain/appointment';
import type { QueueBoardEntry } from '../domain/queue-entry';

export interface DashboardAppointmentCounts {
  total: number;
  requested: number;
  confirmed: number;
  checkedIn: number;
  completed: number;
  cancelled: number;
  noShow: number;
}

export interface DashboardQueueCounts {
  waiting: number;
  called: number;
  inService: number;
  done: number;
  missed: number;
}

/** The small, real read model used by the staff landing page. */
export interface DashboardSummary {
  date: string;
  appointments: DashboardAppointmentCounts;
  queue: DashboardQueueCounts;
  pendingRequests: AppointmentListItem[];
  nowServing: QueueBoardEntry | null;
  nextWaiting: QueueBoardEntry[];
}
