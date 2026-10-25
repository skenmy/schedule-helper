import type { Page } from '@playwright/test';

// The iPhone Duo isn't in Playwright's device list yet. Window sizes are
// Safari's own (WebKit's Safari 27.1 notes: 669 × 867 open in portrait,
// 951 × 585 in landscape, 382 × 580 on the outer screen) and the installed
// app's, measured on one: 867 × 587, with the status bar a column down the
// right. `screen` describes the outer display (466 × 678) open or closed; only
// the window's outer size gives the inner screen away, and Playwright can't
// set that, so `onDuo` does.
const userAgent =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 27_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.1 Mobile/15E148 Safari/604.1';
const base = {
  userAgent,
  screen: { width: 466, height: 678 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

export const IPHONE_DUO = {
  /** Open in landscape: the fold runs down the middle. */
  book: { ...base, viewport: { width: 951, height: 585 } },
  /** The same, installed to the Home Screen: the status bar is a column down the right. */
  bookInstalled: { ...base, viewport: { width: 867, height: 587 } },
  /** Open in portrait: the fold runs across. */
  tabletop: { ...base, viewport: { width: 669, height: 867 } },
  /** The outer screen. */
  closed: { ...base, viewport: { width: 382, height: 580 } },
};

/** The screen each shape's window is on, as its outer size reports it. */
const OUTER: Record<keyof typeof IPHONE_DUO, [number, number]> = {
  book: [951, 669],
  bookInstalled: [951, 669],
  tabletop: [669, 951],
  closed: [466, 678],
};

/** Report the screen the window is on the way a Duo does, before the app loads. */
export async function onDuo(page: Page, shape: keyof typeof IPHONE_DUO): Promise<void> {
  await page.addInitScript(([width, height]) => {
    Object.defineProperty(window, 'outerWidth', { get: () => width, configurable: true });
    Object.defineProperty(window, 'outerHeight', { get: () => height, configurable: true });
  }, OUTER[shape]);
}
