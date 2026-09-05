import { createApp } from 'vue';
import App from './app/App.vue';
import { router, startSession } from './app/router';
// The shared token layer first: the dashboard's own file builds on it.
import '@clinic/client-theme';
import './app/shared/styles/tokens.css';
import './styles.css';

/*
 * Arabic and right-to-left from the first frame.
 *
 * Set on the document rather than in CSS: direction is a document fact, and the
 * layout below is written with logical properties so the sidebar lands on the
 * reading-start side without a single direction-specific rule.
 */
document.documentElement.lang = 'ar';
document.documentElement.dir = 'rtl';

// Start resolving the stored session immediately; the guard awaits the same
// promise, so the first navigation already knows who is signed in.
void startSession();

createApp(App).use(router).mount('#root');
