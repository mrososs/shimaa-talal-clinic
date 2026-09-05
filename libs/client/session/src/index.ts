/**
 * `@clinic/client-session`
 *
 * The signed-in session, shared by the mobile app and the dashboard: the
 * Supabase account, who that account is at the clinic, and the transitions
 * between the two. Framework-light — it uses Vue's reactivity and nothing else,
 * so it stays testable without mounting a component.
 *
 * It holds no screens, no routes and no API paths. Which identity endpoint to
 * call is injected by the app that knows.
 */
export * from './lib/session-store';
