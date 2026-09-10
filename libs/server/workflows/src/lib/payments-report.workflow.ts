import { Injectable } from '@nestjs/common';
import { DatabaseService, type QueryResultRow } from '@clinic/server-core';
import {
  ClinicMemberRole,
  type ClinicPayment,
  type ClinicReport,
  type PaymentRecord,
  type PaymentsDashboard,
} from '@clinic/contracts';
import { PaymentService } from '@clinic/server-payments';

interface NameRow extends QueryResultRow {
  child_id: string;
  child_name: string;
  guardian_id: string;
  guardian_name: string;
}
interface AppointmentAggregateRow extends QueryResultRow {
  status: string;
  visit_type: string;
  source: string;
  total: string;
}
interface QueueAggregateRow extends QueryResultRow {
  avg_wait: string | null;
  avg_service: string | null;
}
interface HourRow extends QueryResultRow {
  arrival_hour: string;
  total: string;
}
interface WeekRow extends QueryResultRow {
  activity_day: string;
  status: string;
  total: string;
}
interface MoneyRow extends QueryResultRow {
  status: string;
  total: string;
}

@Injectable()
export class PaymentsReportWorkflow {
  constructor(
    private readonly database: DatabaseService,
    private readonly payments: PaymentService,
  ) {}

  async paymentsDashboard(clinicId: string): Promise<PaymentsDashboard> {
    const records = await this.payments.list(clinicId);
    const names = records.length
      ? await this.database.query<NameRow>(
          `select distinct p.child_id,c.full_name child_name,p.guardian_id,g.full_name guardian_name
       from clinic.payments p join clinic.children c on c.id=p.child_id and c.clinic_id=p.clinic_id
       join clinic.guardians g on g.id=p.guardian_id and g.clinic_id=p.clinic_id
       where p.clinic_id=$1 and p.storage_status='ready'`,
          [clinicId],
        )
      : { rows: [] as NameRow[] };
    const byChild = new Map(
      names.rows.map((r) => [`${r.child_id}:${r.guardian_id}`, r]),
    );
    const items: ClinicPayment[] = records.map((p: PaymentRecord) => {
      const n = byChild.get(`${p.childId}:${p.guardianId}`);
      return {
        ...p,
        childName: n?.child_name ?? '—',
        guardianName: n?.guardian_name ?? '—',
      };
    });
    return {
      items,
      totals: {
        collectedMinor: items
          .filter((p) => p.status === 'paid')
          .reduce((sum, p) => sum + p.amountMinor, 0),
        pendingMinor: items
          .filter((p) => p.status === 'pending')
          .reduce((sum, p) => sum + p.amountMinor, 0),
        refundedMinor: items
          .filter((p) => p.status === 'refunded')
          .reduce((sum, p) => sum + p.amountMinor, 0),
      },
    };
  }

  async report(input: {
    clinicId: string;
    role: ClinicMemberRole;
    timezone: string;
    from: string;
    to: string;
  }): Promise<ClinicReport> {
    const range = [
      input.clinicId,
      input.from,
      input.to,
      input.timezone,
    ] as const;
    const [appointments, queue, hours, weeks, money] = await Promise.all([
      this.database.query<AppointmentAggregateRow>(
        `select status,visit_type,case when created_by_member_id is null then 'online' else 'clinic' end source,count(*)::text total
         from clinic.appointments where clinic_id=$1 and window_start >= ($2::date at time zone $4)
          and window_start < (($3::date + 1) at time zone $4) group by status,visit_type,source`,
        range,
      ),
      this.database.query<QueueAggregateRow>(
        `select avg(extract(epoch from (started_at-checked_in_at))/60)::text avg_wait,
                avg(extract(epoch from (completed_at-started_at))/60)::text avg_service
         from clinic.queue_entries where clinic_id=$1 and checked_in_at >= ($2::date at time zone $4)
          and checked_in_at < (($3::date + 1) at time zone $4)`,
        range,
      ),
      this.database.query<HourRow>(
        `select extract(hour from checked_in_at at time zone $4)::int::text as arrival_hour,count(*)::text total
         from clinic.queue_entries where clinic_id=$1 and checked_in_at >= ($2::date at time zone $4)
          and checked_in_at < (($3::date + 1) at time zone $4) group by arrival_hour order by count(*) desc,arrival_hour limit 6`,
        range,
      ),
      this.database.query<WeekRow>(
        `select (window_start at time zone $4)::date::text as activity_day,status,count(*)::text total
         from clinic.appointments where clinic_id=$1 and window_start >= ($2::date at time zone $4)
          and window_start < (($3::date + 1) at time zone $4) group by activity_day,status order by activity_day`,
        range,
      ),
      this.database.query<MoneyRow>(
        `select status,coalesce(sum(amount_minor),0)::text total from clinic.payments
         where clinic_id=$1 and storage_status='ready' and created_at >= ($2::date at time zone $4)
          and created_at < (($3::date + 1) at time zone $4) group by status`,
        range,
      ),
    ]);
    const byStatus: Record<string, number> = {},
      byVisitType: Record<string, number> = {};
    let online = 0,
      clinic = 0,
      total = 0;
    for (const row of appointments.rows) {
      const n = Number(row.total);
      total += n;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + n;
      byVisitType[row.visit_type] = (byVisitType[row.visit_type] ?? 0) + n;
      if (row.source === 'online') online += n;
      else clinic += n;
    }
    const days = new Map<
      string,
      { date: string; appointments: number; completed: number }
    >();
    for (const row of weeks.rows) {
      const day = days.get(row.activity_day) ?? {
        date: row.activity_day,
        appointments: 0,
        completed: 0,
      };
      const n = Number(row.total);
      day.appointments += n;
      if (row.status === 'completed') day.completed += n;
      days.set(row.activity_day, day);
    }
    const sums = new Map(money.rows.map((r) => [r.status, Number(r.total)]));
    const q = queue.rows[0];
    const canSeeMoney =
      input.role === ClinicMemberRole.Doctor ||
      input.role === ClinicMemberRole.Admin;
    return {
      from: input.from,
      to: input.to,
      appointments: {
        total,
        completed: byStatus['completed'] ?? 0,
        noShow: byStatus['no_show'] ?? 0,
        byStatus,
        byVisitType,
        bySource: { online, clinic },
      },
      queue: {
        averageWaitMinutes: decimal(q?.avg_wait),
        averageServiceMinutes: decimal(q?.avg_service),
        peakHours: hours.rows.map((row) => ({
          hour: Number(row.arrival_hour),
          count: Number(row.total),
        })),
      },
      financial: canSeeMoney
        ? {
            collectedMinor: sums.get('paid') ?? 0,
            pendingMinor: sums.get('pending') ?? 0,
            refundedMinor: sums.get('refunded') ?? 0,
            currency: 'EGP',
          }
        : null,
      weeklyActivity: [...days.values()],
    };
  }
}

function decimal(value: string | null | undefined): number | null {
  if (value == null) return null;
  return Math.round(Number(value) * 10) / 10;
}
