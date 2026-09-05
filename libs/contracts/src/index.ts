/**
 * `@clinic/contracts`
 *
 * Framework-agnostic vocabulary shared by the mobile app, the dashboard and the
 * API. Pure TypeScript only: no Vue, no Ionic, no NestJS, no Supabase, no HTTP.
 * The `type:contract` boundary rule in `eslint.config.mjs` enforces this.
 *
 * Keep this library small. It is a contract, not a utility drawer. What belongs
 * here is anything that crosses the API boundary — a status a client renders, a
 * shape an endpoint returns — because the alternative is declaring it twice and
 * watching the two copies drift. What does not belong here is anything only one
 * side uses.
 *
 * Naming a state is not the same as asserting what causes it. Booking, Queue
 * and Payments are separate engines; nothing here encodes a pipeline between
 * them. See docs/cross-domain-orchestration.md.
 */

export * from './lib/api/api-response';
export * from './lib/api/api-routes';
export * from './lib/api/health';
export * from './lib/api/me';
export * from './lib/api/pagination';
export * from './lib/api/queue-views';

export * from './lib/domain/appointment';
export * from './lib/domain/appointment-status';
export * from './lib/domain/availability';
export * from './lib/domain/child';
export * from './lib/domain/clinic';
export * from './lib/domain/clinic-member';
export * from './lib/domain/clinic-member-role';
export * from './lib/domain/clinic-session';
export * from './lib/domain/clinic-session-kind';
export * from './lib/domain/clinic-session-status';
export * from './lib/domain/doctor-presence';
export * from './lib/domain/guardian';
export * from './lib/domain/guardian-relationship';
export * from './lib/domain/payment-status';
export * from './lib/domain/queue-entry';
export * from './lib/domain/queue-entry-source';
export * from './lib/domain/queue-status';
export * from './lib/domain/temporal';
export * from './lib/domain/user-role';
export * from './lib/domain/visit-type';
