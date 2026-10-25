import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOLD_TABS,
  foldX,
  isIPad,
  parseFoldTabs,
  parseLayoutPref,
  pickLayout,
  screenSize,
  toggleFoldTab,
} from './layout.ts';

/** A full-screen window unless the screen is given. */
const touch = (width: number, height: number, screenShort = Math.min(width, height)) => ({
  width,
  height,
  screenShort,
  touch: true,
});
const mouse = (width: number, height: number) => ({
  width,
  height,
  screenShort: 1080,
  touch: false,
});

describe('pickLayout', () => {
  it('gives phones the phone layout in both orientations', () => {
    expect(pickLayout(touch(390, 844))).toBe('phone');
    expect(pickLayout(touch(844, 390))).toBe('phone');
    // iPhone Pro Max landscape is wider than the old 820px breakpoint.
    expect(pickLayout(touch(932, 430))).toBe('phone');
  });

  it('gives iPads the tablet layout in both orientations', () => {
    expect(pickLayout(touch(744, 1133))).toBe('tablet'); // iPad mini portrait
    expect(pickLayout(touch(820, 1180))).toBe('tablet'); // iPad Air portrait
    expect(pickLayout(touch(1180, 820))).toBe('tablet');
    expect(pickLayout(touch(1366, 1024))).toBe('tablet'); // 12.9" landscape
  });

  it('falls back to the phone layout in narrow iPad multitasking windows', () => {
    expect(pickLayout(touch(320, 1024, 1024))).toBe('phone'); // Slide Over
    expect(pickLayout(touch(507, 820, 820))).toBe('phone'); // half Split View
    expect(pickLayout(touch(694, 820, 820))).toBe('phone'); // two-thirds on an 11"
    expect(pickLayout(touch(981, 1024, 1024))).toBe('tablet'); // two-thirds on a 13"
  });

  it('keeps a landscape tablet a tablet when the keyboard squashes the window', () => {
    expect(pickLayout(touch(1180, 420, 820))).toBe('tablet');
  });

  it('gives an open iPhone Duo the foldable layout in both orientations', () => {
    // Safari's viewports on the inner screen (WebKit, Safari 27.1).
    expect(pickLayout(touch(669, 867, 669))).toBe('fold');
    expect(pickLayout(touch(951, 585, 669))).toBe('fold');
    // The keyboard squashes the window, not its width.
    expect(pickLayout(touch(951, 280, 669))).toBe('fold');
  });

  it('gives a closed or split iPhone Duo the phone layout', () => {
    // The outer screen, whichever screen `screen` describes.
    expect(pickLayout(touch(382, 580))).toBe('phone');
    expect(pickLayout(touch(594, 368))).toBe('phone');
    expect(pickLayout(touch(382, 580, 669))).toBe('phone');
    expect(pickLayout(touch(594, 368, 669))).toBe('phone');
    // Two windows side by side on the inner screen.
    expect(pickLayout(touch(385, 571, 669))).toBe('phone');
  });

  it('keeps desktop browsers on the old breakpoint', () => {
    expect(pickLayout(mouse(1440, 900))).toBe('desktop');
    expect(pickLayout(mouse(1000, 700))).toBe('desktop');
    expect(pickLayout(mouse(820, 900))).toBe('phone');
    expect(pickLayout(mouse(1200, 400))).toBe('desktop');
  });

  it('honours an explicit preference', () => {
    expect(pickLayout(mouse(1440, 900), 'tablet')).toBe('tablet');
    expect(pickLayout(touch(1180, 820), 'desktop')).toBe('desktop');
    expect(pickLayout(touch(390, 844), 'auto')).toBe('phone');
  });

  it('keeps a foldable chosen by hand on the phone layout while it is closed', () => {
    expect(pickLayout(touch(1028, 876), 'fold')).toBe('fold'); // Galaxy Z Fold, open
    expect(pickLayout(touch(484, 1112), 'fold')).toBe('phone'); // and closed
    expect(pickLayout(mouse(1440, 900), 'fold')).toBe('fold');
  });
});

describe('screenSize', () => {
  it('sees the inner screen of an open iPhone Duo, which `screen` does not', () => {
    // Measured on one, installed and open in landscape.
    expect(screenSize(466, 678, 951, 669)).toEqual({ short: 669, long: 951 });
    expect(pickLayout(touch(867, 587, screenSize(466, 678, 951, 669).short))).toBe('fold');
  });

  it('takes `screen` when the outer size is no bigger, or not reported', () => {
    expect(screenSize(393, 852, 393, 852)).toEqual({ short: 393, long: 852 });
    expect(screenSize(820, 1180, 694, 820)).toEqual({ short: 820, long: 1180 }); // Split View
    expect(screenSize(466, 678, 0, 0)).toEqual({ short: 466, long: 678 });
  });
});

describe('foldX', () => {
  it('finds the crease in the middle of the screen, not the window', () => {
    // Installed on the iPhone Duo: the status bar takes a column off the right.
    expect(foldX(867, 951)).toBe(475.5);
    // Safari has the whole width: the middle of either.
    expect(foldX(951, 951)).toBe(475.5);
  });

  it('falls back to half the window when the screen size is implausible', () => {
    expect(foldX(867, 678)).toBe(433.5); // the outer display
    expect(foldX(1400, 1920)).toBe(700); // a desktop window with the layout forced
  });
});

describe('fold tabs', () => {
  it('keeps the tabs a device chose, known ones only, in order', () => {
    expect(parseFoldTabs(['progress', 'live', 'nope'])).toEqual(['live', 'progress']);
    expect(parseFoldTabs(null)).toEqual(DEFAULT_FOLD_TABS);
    expect(parseFoldTabs([])).toEqual(DEFAULT_FOLD_TABS);
  });

  it('switches one on or off, in its place, never leaving none', () => {
    expect(toggleFoldTab(['live', 'log'], 'schedule')).toEqual(['live', 'schedule', 'log']);
    expect(toggleFoldTab(['live', 'log'], 'live')).toEqual(['log']);
    expect(toggleFoldTab(['log'], 'log')).toEqual(['log']);
  });
});

describe('isIPad', () => {
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
  it('spots iPadOS asking for the desktop site', () => {
    expect(isIPad(MAC, 5)).toBe(true);
    expect(isIPad(MAC, 0)).toBe(false);
    expect(isIPad('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5)).toBe(true);
    expect(isIPad('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe(false);
  });
});

describe('parseLayoutPref', () => {
  it('rejects unknown values', () => {
    expect(parseLayoutPref('tablet')).toBe('tablet');
    expect(parseLayoutPref('fold')).toBe('fold');
    expect(parseLayoutPref('watch')).toBe('auto');
    expect(parseLayoutPref(null)).toBe('auto');
  });
});
