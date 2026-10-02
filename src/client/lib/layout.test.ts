import { describe, expect, it } from 'vitest';
import { isIPad, parseLayoutPref, pickLayout } from './layout.ts';

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
    expect(parseLayoutPref('watch')).toBe('auto');
    expect(parseLayoutPref(null)).toBe('auto');
  });
});
