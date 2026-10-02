// Touch-device niceties: haptics, keeping the screen awake, and knowing when
// we're running as an installed (Home Screen) app.

/**
 * A short tap of haptic feedback. Must be called from a user gesture (a click
 * handler) to do anything. Android vibrates; iOS Safari has no Vibration API,
 * but toggling a native `<input switch>` gives the system's own haptic tick
 * (iOS 18+), so we click a hidden one. Elsewhere this is a no-op.
 */
export function haptic(pattern: number | number[] = 10): void {
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
      return;
    }
    if (!isAppleTouch()) return;
    const label = document.createElement('label');
    label.ariaHidden = 'true';
    label.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.append(input);
    document.head.append(label);
    label.click();
    label.remove();
  } catch {
    // unsupported
  }
}

function isAppleTouch(): boolean {
  return /iPhone|iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

/** Launched from the Home Screen (iOS, iPadOS, Android) rather than a browser tab. */
export function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * iOS Safari only applies `:active` styles when a touch listener exists, so
 * buttons give no press feedback without this.
 */
export function enableActiveStates(): void {
  document.addEventListener('touchstart', () => {}, { passive: true });
}

/**
 * Holds a screen wake lock while `active()` is true, re-acquiring it when the
 * tab becomes visible again (browsers drop locks for hidden tabs).
 * Returns a cleanup function.
 */
export function keepAwake(active: () => boolean): () => void {
  let lock: WakeLockSentinel | null = null;
  const sync = async () => {
    const want = active() && document.visibilityState === 'visible';
    if (want && !lock && 'wakeLock' in navigator) {
      try {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => (lock = null));
      } catch {
        // denied, or battery saver
      }
    } else if (!want && lock) {
      await lock.release().catch(() => {});
      lock = null;
    }
  };
  void sync();
  document.addEventListener('visibilitychange', sync);
  const timer = setInterval(sync, 5_000);
  return () => {
    document.removeEventListener('visibilitychange', sync);
    clearInterval(timer);
    void lock?.release().catch(() => {});
  };
}

const METROPOLIS = 'https://fonts.cdnfonts.com/css/metropolis-2';

/** The UKSG brand font is only fetched when a UKSG schedule is open. */
export function loadBrandFont(): void {
  if (document.querySelector(`link[href="${METROPOLIS}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = METROPOLIS;
  document.head.append(link);
}
