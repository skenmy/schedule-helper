// Touch-device niceties: haptics and keeping the screen awake.

export function haptic(pattern: number | number[] = 10): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // unsupported
  }
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
