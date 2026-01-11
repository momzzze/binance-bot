type Level = 'info' | 'warn' | 'error' | 'debug';

function fmt(level: Level, msg: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [${level.toUpperCase()}] ${msg}`;
}

export function createLogger() {
  return {
    info: (msg: string, ...args: unknown[]) => console.log(fmt('info', msg), ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(fmt('warn', msg), ...args),
    error: (msg: string, ...args: unknown[]) => console.error(fmt('error', msg), ...args),
    debug: (msg: string, ...args: unknown[]) => console.debug(fmt('debug', msg), ...args),
  };
}
