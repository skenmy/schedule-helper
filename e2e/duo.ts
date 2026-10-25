// The iPhone Duo isn't in Playwright's device list yet. Viewports are Safari's
// own (WebKit's Safari 27.1 notes: 669 × 867 open in portrait, 951 × 585 in
// landscape, 382 × 580 on the outer screen); `screen` is the inner display in
// portrait, the way iPhones report it. Closed, that's the harder case: only the
// window's width says the phone is closed.
const userAgent =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 27_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.1 Mobile/15E148 Safari/604.1';
const base = {
  userAgent,
  screen: { width: 669, height: 951 },
  deviceScaleFactor: 2.8,
  isMobile: true,
  hasTouch: true,
};

export const IPHONE_DUO = {
  /** Open in landscape: the fold runs down the middle. */
  book: { ...base, viewport: { width: 951, height: 585 } },
  /** The same, installed to the Home Screen: the status bar is a column down the right. */
  bookInstalled: { ...base, viewport: { width: 867, height: 669 } },
  /** Open in portrait: the fold runs across. */
  tabletop: { ...base, viewport: { width: 669, height: 867 } },
  /** The outer screen. */
  closed: { ...base, viewport: { width: 382, height: 580 } },
};
