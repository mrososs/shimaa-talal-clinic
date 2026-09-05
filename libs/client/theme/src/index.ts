/**
 * `@clinic/client-theme`
 *
 * The design system's token layer, shared by the mobile app and the dashboard.
 * Importing this module applies it — there is no API, because a token layer has
 * no behaviour.
 *
 *   import '@clinic/client-theme';
 *
 * Component classes live with the app that owns them: mobile maps these onto
 * Ionic's `--ion-*` variables, the dashboard builds its own `.d*` primitives on
 * top. What they share is exactly the tokens, which is what makes the two
 * surfaces read as one product.
 */
import './lib/tokens.css';
