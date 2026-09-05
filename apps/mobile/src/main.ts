import { createApp } from 'vue';
import { IonicVue } from '@ionic/vue';
import App from './app/App.vue';
import { router } from './app/router';

/*
 * Ionic's required baseline stylesheets.
 *
 * This is not a design system and not a theme: without these, Ionic's
 * components have no layout at all. The optional utility and palette
 * stylesheets are deliberately not imported — styling decisions come later.
 */
import '@ionic/vue/css/core.css';
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';

import './styles.css';

const app = createApp(App).use(IonicVue).use(router);

// Ionic requires the router to be settled before the first mount.
void router.isReady().then(() => {
  app.mount('#root');
});
