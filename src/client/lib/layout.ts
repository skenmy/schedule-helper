// Which interface a device gets. Pure so the rules can be unit-tested; the
// reactive wrapper that feeds it live window sizes is layout.svelte.ts.

export type LayoutKind = 'phone' | 'fold' | 'tablet' | 'desktop';
export type LayoutPref = 'auto' | LayoutKind;
/** Tablet and foldable: the full console, or a focused view for a floor/stage manager. */
export type TabletMode = 'console' | 'floor';
export const TABLET_MODES: readonly { value: TabletMode; label: string }[] = [
  { value: 'console', label: 'Console' },
  { value: 'floor', label: 'Floor' },
];

export const LAYOUT_PREFS: readonly { id: LayoutPref; name: string }[] = [
  { id: 'auto', name: 'Automatic' },
  { id: 'phone', name: 'Phone' },
  { id: 'fold', name: 'Foldable (iPhone Duo)' },
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
/**
 * Between a phone and the smallest iPad (the mini, 744): a foldable's inner
 * screen. The iPhone Duo's is 669 × 951.
 */
const TABLET_SHORT_SIDE = 744;
/**
 * A foldable window narrower than this is the outer screen (the iPhone Duo's
 * is 382 wide, 594 turned) or half of a Split View (385), so it's a phone.
 * Open, the Duo is 669 wide or more. Width alone, so the keyboard can't flip it.
 */
const FOLD_MIN_WIDTH = 620;
/** iPad Split View / Slide Over narrower than this gets the phone layout. */
const TABLET_MIN_WIDTH = 700;

export function pickLayout(env: LayoutEnv, pref: LayoutPref = 'auto'): LayoutKind {
  // Chosen by hand, a foldable still gets the phone layout while it's closed.
  if (pref === 'fold') return env.width < FOLD_MIN_WIDTH ? 'phone' : 'fold';
  if (pref !== 'auto') return pref;
  if (!env.touch) return env.width <= DESKTOP_PHONE_MAX ? 'phone' : 'desktop';
  if (env.screenShort < PHONE_SHORT_SIDE) return 'phone';
  if (env.screenShort < TABLET_SHORT_SIDE) return env.width < FOLD_MIN_WIDTH ? 'phone' : 'fold';
  return env.width < TABLET_MIN_WIDTH ? 'phone' : 'tablet';
}

/**
 * Where a foldable open like a book folds, from the window's left edge. It folds
 * down the middle of the screen, but installed on the iPhone Duo the status bar
 * is a column down the right of the screen, whichever way round the phone is,
 * and the window stops at it: half the window is left of the crease.
 * `screen` is trusted only while it plausibly describes this screen, with the
 * crease at or right of the window's middle and not far past it.
 */
export function foldX(windowWidth: number, screenWidth: number, screenHeight: number): number {
  const middle = Math.max(screenWidth, screenHeight) / 2;
  return middle >= windowWidth / 2 && middle <= windowWidth * 0.6 ? middle : windowWidth / 2;
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
