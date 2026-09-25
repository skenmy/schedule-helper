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

mount(App, { target: document.getElementById('app')! });
