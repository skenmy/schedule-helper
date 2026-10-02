import '@fontsource-variable/inter-tight';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/brand-uksg.css';
import './styles/huds.css';

import { mount } from 'svelte';
import App from './App.svelte';
import { enableActiveStates } from './lib/device.ts';

enableActiveStates();
mount(App, { target: document.getElementById('app')! });

// The service worker caches the app shell so the installed app opens offline
// (src/client/sw.ts). Production builds only: in dev it would cache Vite's modules.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('service worker', err));
  });
}
