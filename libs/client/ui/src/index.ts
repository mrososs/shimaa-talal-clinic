/**
 * `@clinic/client-ui`
 *
 * The building blocks both apps need to behave identically — a component where
 * they would otherwise draw the same thing twice, a composable where they would
 * otherwise get the same lifecycle subtly differently.
 *
 * Not a component library and not on its way to becoming one. Something earns a
 * place here when having two copies has already caused, or would obviously
 * cause, the two surfaces to drift.
 *
 * Everything here renders with the `@clinic/client-theme` tokens and nothing
 * else. No Ionic, no UI framework — the dashboard has neither, and a shared
 * piece that only works in one app is not shared.
 */
export { default as ClinicDialog } from './lib/ClinicDialog.vue';
export {
  usePolling,
  createSequence,
  type Polling,
  type PollingOptions,
  type Sequence,
} from './lib/use-polling';
