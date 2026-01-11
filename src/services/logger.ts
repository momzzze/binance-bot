import util from 'node:util';

type Level = 'info' | 'warn' | 'error' | 'debug';

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

const LEVEL_COLOR: Record<Level, string> = {
  info: COLORS.cyan,
  warn: COLORS.yellow,
  error: COLORS.red,
  debug: COLORS.magenta,
};

const LEVEL_ICON: Record<Level, string> = {
  info: 'ℹ',
  warn: '⚠',
  error: '✖',
  debug: '•',
};

function format(level: Level, msg: string): string {
  const ts = new Date().toISOString();
  const timePart = ts.substring(11, 23) + 'Z'; // HH:MM:SS.mmmZ
  const color = process.stdout.isTTY ? LEVEL_COLOR[level] : '';
  const reset = process.stdout.isTTY ? COLORS.reset : '';
  const dim = process.stdout.isTTY ? COLORS.dim : '';
  const icon = LEVEL_ICON[level];
  const tag = `${color}${icon} ${level.toUpperCase().padEnd(5)}${reset}`;
  return `${dim}[${timePart}]${reset} ${tag} ${msg}`;
}

function serializeArgs(args: unknown[]): string {
  if (!args.length) return '';
  const parts = args.map((a) => {
    if (typeof a === 'string') return a;
    return util.inspect(a, {
      colors: process.stdout.isTTY,
      depth: 4,
      maxArrayLength: 20,
      breakLength: 120,
      compact: 3,
    });
  });
  return ' ' + parts.join(' ');
}

export function createLogger(scope?: string) {
  const prefix = scope ? `[${scope}] ` : '';
  return {
    info: (msg: string, ...args: unknown[]) =>
      console.log(format('info', prefix + msg) + serializeArgs(args)),
    warn: (msg: string, ...args: unknown[]) =>
      console.warn(format('warn', prefix + msg) + serializeArgs(args)),
    error: (msg: string, ...args: unknown[]) =>
      console.error(format('error', prefix + msg) + serializeArgs(args)),
    debug: (msg: string, ...args: unknown[]) =>
      console.debug(format('debug', prefix + msg) + serializeArgs(args)),
  };
}
