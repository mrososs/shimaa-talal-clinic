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
          `select name,phone_e164,address,instapay_handle,timezone,
                  grace_period_minutes,default_avg_consult_minutes,
                  max_self_defers,min_lead_minutes,cancellation_cutoff_minutes,
                  auto_confirm_parent_bookings,tracking_estimator_enabled,
                  reception_estimate_visible,parent_estimate_visible,
                  guest_tracking_enabled,attendance_intent_enabled,
                  fairness_placement_enabled,arrival_buffer_minutes,
                  early_check_in_minutes,minimum_travel_lead_minutes,
                  estimate_publication_threshold_minutes,
                  max_earlier_shift_minutes,configured_baseline_minutes,
                  baseline_validated_at,parent_estimate_approved_at
             from clinic.clinics where id=$1`,
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
        instapayHandle: c.instapay_handle,
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
      tracking: {
        estimatorEnabled: c.tracking_estimator_enabled,
        receptionVisible: c.reception_estimate_visible,
        parentVisible: c.parent_estimate_visible,
        guestEnabled: c.guest_tracking_enabled,
        attendanceEnabled: c.attendance_intent_enabled,
        fairnessEnabled: c.fairness_placement_enabled,
        arrivalBufferMinutes: c.arrival_buffer_minutes,
        earlyCheckInMinutes: c.early_check_in_minutes,
        minimumTravelLeadMinutes: c.minimum_travel_lead_minutes,
        publicationThresholdMinutes:
          c.estimate_publication_threshold_minutes,
        maxEarlierShiftMinutes: c.max_earlier_shift_minutes,
        configuredBaselineMinutes: c.configured_baseline_minutes,
        baselineValidatedAt: c.baseline_validated_at?.toISOString() ?? null,
        parentEstimateApprovedAt:
          c.parent_estimate_approved_at?.toISOString() ?? null,
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
    input: {
      name: string;
      phoneE164?: string;
      address?: string;
      instapayHandle?: string;
    },
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
          'select name,phone_e164,address,instapay_handle from clinic.clinics where id=$1 for update',
          [clinicId],
        );
        const after = await one(
          tx,
          'update clinic.clinics set name=$2,phone_e164=$3,address=$4,instapay_handle=$5 where id=$1 returning name,phone_e164,address,instapay_handle',
          [
            clinicId,
            input.name,
            input.phoneE164 ?? null,
            input.address ?? null,
            input.instapayHandle?.trim() || null,
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
  tracking(clinicId: string, actor: string, input: any) {
    return this.mutate(
      clinicId,
      actor,
      'clinic.tracking_updated',
      'clinic',
      clinicId,
      async (tx) => {
        const columns = `tracking_estimator_enabled,reception_estimate_visible,
          parent_estimate_visible,guest_tracking_enabled,
          attendance_intent_enabled,fairness_placement_enabled,
          arrival_buffer_minutes,early_check_in_minutes,
          minimum_travel_lead_minutes,estimate_publication_threshold_minutes,
          max_earlier_shift_minutes,configured_baseline_minutes,
          baseline_validated_at,parent_estimate_approved_at`;
        const before = await one(
          tx,
          `select ${columns} from clinic.clinics where id=$1 for update`,
          [clinicId],
        );
        const baselineChanged =
          before.configured_baseline_minutes !== input.configuredBaselineMinutes;
        const approve = input.approveParentEstimate === true;
        if (input.validateBaseline === true && input.configuredBaselineMinutes == null) {
          throw new BadRequestException(
            'A configured baseline is required before validation.',
          );
        }
        if (
          approve &&
          before.baseline_validated_at == null &&
          input.validateBaseline !== true
        ) {
          throw new BadRequestException(
            'The consultation baseline must be validated before shadow approval.',
          );
        }
        if (approve) await this.requireShadowReleaseGate(clinicId, tx);
        if (
          input.parentVisible === true &&
          !approve &&
          before.parent_estimate_approved_at == null
        ) {
          throw new BadRequestException(
            'Parent estimates cannot be enabled before shadow approval.',
          );
        }
        const after = await one(
          tx,
          `update clinic.clinics set
             tracking_estimator_enabled=$3,reception_estimate_visible=$4,
             parent_estimate_visible=$5,guest_tracking_enabled=$6,
             attendance_intent_enabled=$7,fairness_placement_enabled=$8,
             arrival_buffer_minutes=$9,early_check_in_minutes=$10,
             minimum_travel_lead_minutes=$11,
             estimate_publication_threshold_minutes=$12,
             max_earlier_shift_minutes=$13,configured_baseline_minutes=$14,
             baseline_source=case when $14::integer is null then null
                                  else 'clinic_configured' end,
             baseline_validated_at=case when $15 then now()
                                        when $16 then null
                                        else baseline_validated_at end,
             baseline_validated_by=case when $15 then $2::uuid
                                        when $16 then null
                                        else baseline_validated_by end,
             estimator_shadow_started_at=case when $3 and not tracking_estimator_enabled
                                              then now()
                                              else estimator_shadow_started_at end,
             parent_estimate_approved_at=case when $17 then now()
                                              else parent_estimate_approved_at end,
             parent_estimate_approved_by=case when $17 then $2::uuid
                                              else parent_estimate_approved_by end
           where id=$1 returning ${columns}`,
          [clinicId, actor, input.estimatorEnabled, input.receptionVisible,
            input.parentVisible, input.guestEnabled, input.attendanceEnabled,
            input.fairnessEnabled, input.arrivalBufferMinutes,
            input.earlyCheckInMinutes, input.minimumTravelLeadMinutes,
            input.publicationThresholdMinutes, input.maxEarlierShiftMinutes,
            input.configuredBaselineMinutes, input.validateBaseline === true,
            baselineChanged, approve],
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
  private async requireShadowReleaseGate(
    clinicId: string,
    tx: SqlExecutor,
  ): Promise<void> {
    const result = await tx.query<any>(
      `with latest as (
         select distinct on (e.appointment_id)
           e.appointment_id,e.metadata
         from clinic.appointment_tracking_events e
         where e.clinic_id=$1
           and e.event_type in ('shadow_published','parent_published')
           and e.metadata->>'consultationFrom' is not null
         order by e.appointment_id,e.created_at desc
       ), samples as (
         select q.session_id,q.started_at,
                (latest.metadata->>'consultationFrom')::timestamptz estimate_from,
                (latest.metadata->>'consultationTo')::timestamptz estimate_to
         from latest
         join clinic.queue_entries q
           on q.appointment_id=latest.appointment_id and q.clinic_id=$1
         where q.started_at is not null
       )
       select count(*)::integer sample_count,
              count(distinct session_id)::integer session_count,
              coalesce(avg((started_at between estimate_from-interval '10 minutes'
                                      and estimate_to+interval '10 minutes')::int),0)::float8 coverage,
              coalesce(percentile_cont(.5) within group (order by
                abs(extract(epoch from (started_at-
                  (estimate_from+(estimate_to-estimate_from)/2))))/60),999)::float8 median_error,
              coalesce(avg((started_at < estimate_from-interval '10 minutes')::int),0)::float8 unsafe_early
         from samples`,
      [clinicId],
    );
    const gate = result.rows[0];
    if (
      !gate || gate.sample_count < 30 || gate.session_count < 5 ||
      gate.coverage < 0.7 || gate.median_error > 15 || gate.unsafe_early > 0.1
    ) {
      throw new BadRequestException({
        code: 'estimator_shadow_gate_not_ready',
        message: 'Shadow estimator quality gate has not passed yet.',
        metrics: gate ?? null,
      });
    }
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
