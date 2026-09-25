// A shared ticking clock, corrected to server time. Timers are stored as
// absolute server timestamps, so every client must use the same clock or a
// laptop that's 20s fast shows a timer 20s ahead.

class Clock {
  local = $state(Date.now());
  /** serverTime − localTime, measured by ping round-trips. */
  offset = $state(0);
  now = $derived(this.local + this.offset);

  constructor() {
    setInterval(() => (this.local = Date.now()), 250);
  }

  /** Fresh server-corrected time, for event handlers between ticks. */
  read(): number {
    return Date.now() + this.offset;
  }

  calibrate(sentAt: number, serverTime: number): void {
    const receivedAt = Date.now();
    const rtt = receivedAt - sentAt;
    if (rtt > 5_000) return;
    const next = serverTime + rtt / 2 - receivedAt;
    if (Math.abs(next - this.offset) > 40) this.offset = Math.round(next);
  }
}

export const clock = new Clock();
