// Minimal leveled logger with ISO timestamps and a scope tag.

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level) || 'info'] ?? ORDER.info;

export function logger(scope: string) {
  const emit =
    (level: Level) =>
    (...args: unknown[]) => {
      if (ORDER[level] < threshold || process.env.VITEST) return;
      const line = [new Date().toISOString(), level.toUpperCase().padEnd(5), `[${scope}]`];
      (level === 'error' ? console.error : console.log)(...line, ...args);
    };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}
