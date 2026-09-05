/**
 * Two aliases that make every timestamp in these contracts say what it is.
 *
 * They are aliases, not branded types — the compiler will not stop you passing
 * one where the other belongs. Their job is to answer, at the use site, the
 * question that causes the most bugs in a clinic system: *is this an instant,
 * or is this a day in the clinic's own timezone?*
 *
 * A clinic's day boundary is its own (`clinics.timezone`, `Africa/Cairo` for
 * the pilot), never the server's and never the viewer's. "Today's appointments"
 * at 23:30 UTC is tomorrow in Cairo.
 */

/** ISO 8601 instant in UTC, e.g. `2026-09-10T09:00:00.000Z`. */
export type IsoInstant = string;

/** Calendar date in the clinic's timezone, `YYYY-MM-DD`. Carries no time and no offset. */
export type IsoDate = string;
