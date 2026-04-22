export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child() {
    return noopLogger;
  },
};

export interface ConsoleLoggerOptions {
  level?: LogLevel;
  now?: () => Date;
  write?: (line: string) => void;
  baseFields?: LogFields;
}

export function createConsoleLogger(opts: ConsoleLoggerOptions = {}): Logger {
  const minLevel = LEVEL_ORDER[opts.level ?? 'info'];
  const now = opts.now ?? (() => new Date());
  const write = opts.write ?? ((line: string) => process.stdout.write(line + '\n'));
  const baseFields = opts.baseFields ?? {};
  return makeLogger(minLevel, now, baseFields, (level, message, fields) => {
    const ts = now().toISOString();
    const merged = { ...baseFields, ...(fields ?? {}) };
    const extra = Object.keys(merged).length
      ? ' ' + Object.entries(merged).map(([k, v]) => `${k}=${formatValue(v)}`).join(' ')
      : '';
    write(`${ts} ${level.toUpperCase().padEnd(5)} ${message}${extra}`);
  });
}

export interface JsonLoggerOptions {
  level?: LogLevel;
  now?: () => Date;
  write: (line: string) => void;
  baseFields?: LogFields;
}

export function createJsonLogger(opts: JsonLoggerOptions): Logger {
  const minLevel = LEVEL_ORDER[opts.level ?? 'info'];
  const now = opts.now ?? (() => new Date());
  const baseFields = opts.baseFields ?? {};
  return makeLogger(minLevel, now, baseFields, (level, message, fields) => {
    const entry = {
      ts: now().toISOString(),
      level,
      message,
      ...baseFields,
      ...(fields ?? {}),
    };
    opts.write(JSON.stringify(entry));
  });
}

export interface BufferLogger extends Logger {
  readonly entries: readonly BufferedEntry[];
  clear(): void;
}

export interface BufferedEntry {
  ts: string;
  level: LogLevel;
  message: string;
  fields: LogFields;
}

export function createBufferLogger(opts: { level?: LogLevel } = {}): BufferLogger {
  const entries: BufferedEntry[] = [];
  const minLevel = LEVEL_ORDER[opts.level ?? 'debug'];
  const base: Logger = makeLogger(minLevel, () => new Date(), {}, (level, message, fields) => {
    entries.push({ ts: new Date().toISOString(), level, message, fields: fields ?? {} });
  });
  return Object.assign(base, {
    entries,
    clear() {
      entries.length = 0;
    },
  });
}

function makeLogger(
  minLevel: number,
  now: () => Date,
  baseFields: LogFields,
  sink: (level: LogLevel, message: string, fields?: LogFields) => void,
): Logger {
  function log(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < minLevel) return;
    sink(level, message, fields);
  }
  return {
    debug: (m, f) => log('debug', m, f),
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
    child(childFields: LogFields): Logger {
      return makeLogger(minLevel, now, { ...baseFields, ...childFields }, (level, message, fields) => {
        sink(level, message, { ...childFields, ...(fields ?? {}) });
      });
    },
  };
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return v.includes(' ') ? JSON.stringify(v) : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
