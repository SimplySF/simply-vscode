import { mount } from 'svelte';
import App from './App.svelte';
import type { InitialState } from './types';

declare global {
    interface Window {
        __INITIAL_STATE__: InitialState;
    }
}

const target = document.getElementById('app');
if (target) {
    mount(App, { target, props: { initial: window.__INITIAL_STATE__ } });
}
