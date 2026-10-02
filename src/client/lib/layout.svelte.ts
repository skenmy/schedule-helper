// The live layout for this device: phone, tablet or desktop, from the window
// size, the pointer and the per-device override in prefs. Mirrors itself onto
// <html data-layout data-touch> so CSS can size touch targets without props.

import { MediaQuery } from 'svelte/reactivity';
import { innerHeight, innerWidth } from 'svelte/reactivity/window';
import { isIPad, pickLayout, type LayoutKind } from './layout.ts';
import { prefs } from './prefs.svelte.ts';

const ipad = isIPad(navigator.userAgent, navigator.maxTouchPoints ?? 0);
const coarse = new MediaQuery('pointer: coarse');

class Layout {
  /** A finger is the main way in: bigger targets, no hover-only affordances. */
  touch = $derived(coarse.current || ipad);
  kind = $derived<LayoutKind>(
    pickLayout(
      {
        width: innerWidth.current ?? window.innerWidth,
        height: innerHeight.current ?? window.innerHeight,
        touch: this.touch,
      },
      prefs.layout,
    ),
  );

  constructor() {
    // Once now, before the first paint, then on every change.
    this.#apply();
    $effect.root(() => {
      $effect(() => this.#apply());
    });
  }

  #apply(): void {
    const html = document.documentElement;
    html.dataset.layout = this.kind;
    html.toggleAttribute('data-touch', this.touch);
  }
}

export const layout = new Layout();
