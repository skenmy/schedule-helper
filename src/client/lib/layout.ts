// Which interface a device gets. Pure so the rules can be unit-tested; the
// reactive wrapper that feeds it live window sizes is layout.svelte.ts.

export type LayoutKind = 'phone' | 'tablet' | 'desktop';
export type LayoutPref = 'auto' | LayoutKind;
/** Tablet only: the full console, or a focused view for a floor/stage manager. */
export type TabletMode = 'console' | 'floor';

export const LAYOUT_PREFS: readonly { id: LayoutPref; name: string }[] = [
  { id: 'auto', name: 'Automatic' },
  { id: 'phone', name: 'Phone' },
  { id: 'tablet', name: 'Tablet' },
  { id: 'desktop', name: 'Desktop' },
];

export interface LayoutEnv {
  /** Window size, which multitasking (Split View, Stage Manager) can shrink. */
  width: number;
  height: number;
  /**
   * The device screen's short side. Phones are told apart by this, not the
   * window, so an on-screen keyboard that squashes the window can't turn a
   * landscape tablet into a phone mid-typing.
   */
  screenShort: number;
  /** The primary pointer is a finger (`(pointer: coarse)`), or this is an iPad. */
  touch: boolean;
}

/** Narrow desktop windows have always switched to the phone layout here. */
const DESKTOP_PHONE_MAX = 820;
/** A touch screen shorter than this on its short side is a phone, in either orientation. */
const PHONE_SHORT_SIDE = 500;
/** iPad Split View / Slide Over narrower than this gets the phone layout. */
const TABLET_MIN_WIDTH = 700;

export function pickLayout(env: LayoutEnv, pref: LayoutPref = 'auto'): LayoutKind {
  if (pref !== 'auto') return pref;
  if (!env.touch) return env.width <= DESKTOP_PHONE_MAX ? 'phone' : 'desktop';
  if (env.screenShort < PHONE_SHORT_SIDE) return 'phone';
  return env.width < TABLET_MIN_WIDTH ? 'phone' : 'tablet';
}

/**
 * iPadOS Safari asks for desktop sites by default, so its user agent says
 * "Macintosh" — the touch points give it away. With a trackpad attached it can
 * also report a fine pointer, which is why this doesn't rely on `pointer: coarse`.
 */
export function isIPad(userAgent: string, maxTouchPoints: number): boolean {
  return /iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

export function parseLayoutPref(value: unknown): LayoutPref {
  return LAYOUT_PREFS.some((p) => p.id === value) ? (value as LayoutPref) : 'auto';
}
