import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type QueryResultRow,
  type SqlExecutor,
} from '@clinic/server-core';
import type { ClinicAuditEvent, ClinicSettings } from '@clinic/contracts';

@Injectable()
export class ClinicSettingsService {
  constructor(private readonly database: DatabaseService) {}
  async read(clinicId: string): Promise<ClinicSettings> {
    const [clinic, prices, templates, schedules, closures, team] =
      await Promise.all([
        this.database.query<any>(
          `select name,phone_e164,address,timezone,grace_period_minutes,default_avg_consult_minutes,max_self_defers,min_lead_minutes,cancellation_cutoff_minutes,auto_confirm_parent_bookings from clinic.clinics where id=$1`,
          [clinicId],
        ),
        this.database.query<any>(
          `select visit_type,amount_minor,currency,active from clinic.service_prices where clinic_id=$1 order by visit_type`,
          [clinicId],
        ),
        this.database.query<any>(
          `select template_key,body,active from clinic.notification_templates where clinic_id=$1 order by template_key`,
          [clinicId],
        ),
        this.database.query<any>(
          `select id,doctor_member_id,weekday,session_kind,starts_at::text,ends_at::text,window_minutes,capacity_per_window,effective_from::text,effective_to::text,active from clinic.clinic_schedules where clinic_id=$1 order by weekday,starts_at,effective_from desc`,
          [clinicId],
        ),
        this.database.query<any>(
          `select id,doctor_member_id,starts_at,ends_at,reason from clinic.clinic_closures where clinic_id=$1 and ends_at>=now() order by starts_at limit 50`,
          [clinicId],
        ),
        this.database.query<any>(
          `select id,display_name,role,status from clinic.clinic_members where clinic_id=$1 order by status,display_name`,
          [clinicId],
        ),
      ]);
    const c = clinic.rows[0];
    if (!c) throw new BadRequestException('Clinic is unavailable.');
    return {
      profile: {
        name: c.name,
        phoneE164: c.phone_e164,
        address: c.address,
        timezone: c.timezone,
      },
      policies: {
        gracePeriodMinutes: c.grace_period_minutes,
        defaultAvgConsultMinutes: c.default_avg_consult_minutes,
        maxSelfDefers: c.max_self_defers,
        minLeadMinutes: c.min_lead_minutes,
        cancellationCutoffMinutes: c.cancellation_cutoff_minutes,
        autoConfirmParentBookings: c.auto_confirm_parent_bookings,
      },
      prices: prices.rows.map((r: any) => ({
        visitType: r.visit_type,
        amountMinor: r.amount_minor,
        currency: r.currency,
        active: r.active,
      })),
      templates: templates.rows.map((r: any) => ({
        key: r.template_key,
        body: r.body,
        active: r.active,
      })),
      schedules: schedules.rows.map((r: any) => ({
        id: r.id,
        doctorMemberId: r.doctor_member_id,
        weekday: r.weekday,
        sessionKind: r.session_kind,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        windowMinutes: r.window_minutes,
        capacityPerWindow: r.capacity_per_window,
        effectiveFrom: r.effective_from,
        effectiveTo: r.effective_to,
        active: r.active,
      })),
      closures: closures.rows.map((r: any) => ({
        id: r.id,
        doctorMemberId: r.doctor_member_id,
        startsAt: r.starts_at.toISOString(),
        endsAt: r.ends_at.toISOString(),
        reason: r.reason,
      })),
      team: team.rows.map((r: any) => ({
        id: r.id,
        displayName: r.display_name,
        role: r.role,
        status: r.status,
      })),
    };
  }
  profile(
    clinicId: string,
    actor: string,
    input: { name: string; phoneE164?: string; address?: string },
  ) {
    return this.mutate(
      clinicId,
      actor,
      'clinic.profile_updated',
      'clinic',
      clinicId,
      async (tx) => {
        const before = await one(
          tx,
          'select name,phone_e164,address from clinic.clinics where id=$1 for update',
          [clinicId],
        );
        const after = await one(
          tx,
          'update clinic.clinics set name=$2,phone_e164=$3,address=$4 where id=$1 returning name,phone_e164,address',
          [
            clinicId,
            input.name,
            input.phoneE164 ?? null,
            input.address ?? null,
          ],
        );
        return { before, after, result: undefined };
      },
    );
  }
  policies(clinicId: string, actor: string, input: any) {
    return this.mutate(
      clinicId,
      actor,
      'clinic.policies_updated',
      'clinic',
      clinicId,
      async (tx) => {
        const before = await one(
          tx,
          'select grace_period_minutes,default_avg_consult_minutes,max_self_defers,min_lead_minutes,cancellation_cutoff_minutes,auto_confirm_parent_bookings from clinic.clinics where id=$1 for update',
          [clinicId],
        );
        const after = await one(
          tx,
          `update clinic.clinics set grace_period_minutes=$2,default_avg_consult_minutes=$3,max_self_defers=$4,min_lead_minutes=$5,cancellation_cutoff_minutes=$6,auto_confirm_parent_bookings=$7 where id=$1 returning grace_period_minutes,default_avg_consult_minutes,max_self_defers,min_lead_minutes,cancellation_cutoff_minutes,auto_confirm_parent_bookings`,
          [
            clinicId,
            input.gracePeriodMinutes,
            input.defaultAvgConsultMinutes,
            input.maxSelfDefers,
            input.minLeadMinutes,
            input.cancellationCutoffMinutes,
            input.autoConfirmParentBookings,
          ],
        );
        return { before, after, result: undefined };
      },
    );
  }
  price(
    clinicId: string,
    actor: string,
    visitType: string,
    input: { amountMinor: number; active: boolean },
  ) {
    return this.mutate(
      clinicId,
      actor,
      'price.updated',
      'service_price',
      visitType,
      async (tx) => {
        const before =
          (
            await tx.query(
              `select amount_minor,active from clinic.service_prices where clinic_id=$1 and visit_type=$2`,
              [clinicId, visitType],
            )
          ).rows[0] ?? null;
        const after = await one(
          tx,
          `insert into clinic.service_prices(clinic_id,visit_type,amount_minor,active) values($1,$2,$3,$4) on conflict(clinic_id,visit_type) do update set amount_minor=excluded.amount_minor,active=excluded.active returning amount_minor,active`,
          [clinicId, visitType, input.amountMinor, input.active],
        );
        return { before, after, result: undefined };
      },
    );
  }
  template(
    clinicId: string,
    actor: string,
    key: string,
    input: { body: string; active: boolean },
  ) {
    return this.mutate(
      clinicId,
      actor,
      'notification_template.updated',
      'notification_template',
      key,
      async (tx) => {
        const before =
          (
            await tx.query(
              `select body,active from clinic.notification_templates where clinic_id=$1 and template_key=$2`,
              [clinicId, key],
            )
          ).rows[0] ?? null;
        const after = await one(
          tx,
          `insert into clinic.notification_templates(clinic_id,template_key,body,active) values($1,$2,$3,$4) on conflict(clinic_id,template_key) do update set body=excluded.body,active=excluded.active returning body,active`,
          [clinicId, key, input.body, input.active],
        );
        return { before, after, result: undefined };
      },
    );
  }
  schedule(clinicId: string, actor: string, input: any) {
    return this.mutate(
      clinicId,
      actor,
      'schedule.version_created',
      'clinic_schedule',
      input.doctorMemberId,
      async (tx) => {
        const today = (
          await one(
            tx,
            `select (now() at time zone timezone)::date::text today from clinic.clinics where id=$1`,
            [clinicId],
          )
        ).today;
        if (input.effectiveFrom <= today)
          throw new BadRequestException(
            'New schedule versions must start after today.',
          );
        await tx.query(
        `update clinic.clinic_schedules set effective_to=$5::date-1 where clinic_id=$1 and doctor_member_id=$2 and weekday=$3 and session_kind=$4 and active and (effective_to is null or effective_to >= $5)`,
          [
            clinicId,
            input.doctorMemberId,
            input.weekday,
            input.sessionKind,
            input.effectiveFrom,
          ],
        );
        const after = await one(
          tx,
          `insert into clinic.clinic_schedules(clinic_id,doctor_member_id,weekday,session_kind,starts_at,ends_at,window_minutes,capacity_per_window,effective_from) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id,doctor_member_id,weekday,session_kind,effective_from`,
          [
            clinicId,
            input.doctorMemberId,
            input.weekday,
            input.sessionKind,
            input.startsAt,
            input.endsAt,
            input.windowMinutes,
            input.capacityPerWindow,
            input.effectiveFrom,
          ],
        );
        return { before: null, after, result: after };
      },
    );
  }
  closure(clinicId: string, actor: string, input: any) {
    return this.mutate(
      clinicId,
      actor,
      'closure.created',
      'clinic_closure',
      'new',
      async (tx) => {
        const after = await one(
          tx,
          `insert into clinic.clinic_closures(clinic_id,doctor_member_id,starts_at,ends_at,reason,created_by_member_id) values($1,$2,$3,$4,$5,$6) returning id,starts_at,ends_at,reason`,
          [
            clinicId,
            input.doctorMemberId ?? null,
            input.startsAt,
            input.endsAt,
            input.reason,
            actor,
          ],
        );
        return { before: null, after, result: after };
      },
    );
  }
  team(clinicId: string, actor: string, id: string, input: any) {
    if (id === actor && input.status === 'suspended')
      throw new BadRequestException('You cannot suspend your own account.');
    return this.mutate(
      clinicId,
      actor,
      'team_member.updated',
      'clinic_member',
      id,
      async (tx) => {
        const before = await one(
          tx,
          'select display_name,role,status from clinic.clinic_members where id=$1 and clinic_id=$2 for update',
          [id, clinicId],
        );
        const after = await one(
          tx,
          'update clinic.clinic_members set display_name=$3,role=$4,status=$5 where id=$1 and clinic_id=$2 returning display_name,role,status',
          [id, clinicId, input.displayName, input.role, input.status],
        );
        return { before, after, result: undefined };
      },
    );
  }
  async audit(clinicId: string): Promise<ClinicAuditEvent[]> {
    const r = await this.database.query<any>(
      `select a.id,m.display_name actor_name,a.action,a.entity_type,a.entity_id,a.created_at from clinic.audit_events a join clinic.clinic_members m on m.id=a.actor_member_id where a.clinic_id=$1 order by a.created_at desc,a.id desc limit 200`,
      [clinicId],
    );
    return r.rows.map((x: any) => ({
      id: x.id,
      actorName: x.actor_name,
      action: x.action,
      entityType: x.entity_type,
      entityId: x.entity_id,
      createdAt: x.created_at.toISOString(),
    }));
  }
  private async mutate<T>(
    clinicId: string,
    actor: string,
    action: string,
    type: string,
    id: string,
    work: (
      tx: SqlExecutor,
    ) => Promise<{ before: unknown; after: unknown; result: T }>,
  ): Promise<T> {
    return this.database.transaction(async (tx) => {
      const out = await work(tx);
      await tx.query(
        `insert into clinic.audit_events(clinic_id,actor_member_id,action,entity_type,entity_id,before_state,after_state) values($1,$2,$3,$4,$5,$6,$7)`,
        [
          clinicId,
          actor,
          action,
          type,
          String((out.after as any)?.id ?? id),
          JSON.stringify(out.before),
          JSON.stringify(out.after),
        ],
      );
      return out.result;
    });
  }
}
async function one(db: SqlExecutor, sql: string, params: readonly unknown[]) {
  const row = (await db.query<QueryResultRow>(sql, params)).rows[0];
  if (!row)
    throw new BadRequestException('The requested setting no longer exists.');
  return row as any;
}
