import { createApp } from 'vue';
import { IonicVue } from '@ionic/vue';
import App from './app/App.vue';
import { router, startSession } from './app/router';

/*
 * Ionic's required baseline stylesheets.
 *
 * Without these, Ionic's components have no layout at all. The clinic's own
 * theme follows them, so its custom properties win.
 */
import '@ionic/vue/css/core.css';
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';

// The shared token layer first: the app's own file maps these onto Ionic.
import '@clinic/client-theme';
import './app/shared/theme/variables.css';
import './styles.css';

/*
 * The product is Arabic and right-to-left, everywhere, from the first frame.
 *
 * Set on the document rather than in CSS because direction is a document fact:
 * Ionic reads it when it decides which way a page transition slides and which
 * side a back button sits on, and it has to be true before the first mount.
 */
document.documentElement.lang = 'ar';
document.documentElement.dir = 'rtl';

const app = createApp(App).use(IonicVue).use(router);

// Start resolving the stored session immediately, in parallel with the router
// settling. The guard awaits the same promise, so the first navigation already
// knows whether anyone is signed in.
void startSession();

// Ionic requires the router to be settled before the first mount.
void router.isReady().then(() => {
  app.mount('#root');
});
