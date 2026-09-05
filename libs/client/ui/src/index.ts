/**
 * `@clinic/client-ui`
 *
 * The few pieces of interface both apps need to render identically. Not a
 * component library and not on its way to becoming one: something earns a place
 * here when the mobile app and the dashboard would otherwise build the same
 * thing twice and drift.
 *
 * Everything here renders with the `@clinic/client-theme` tokens and nothing
 * else. No Ionic, no UI framework — the dashboard has neither, and a shared
 * component that only works in one app is not shared.
 */
export { default as ClinicDialog } from './lib/ClinicDialog.vue';
