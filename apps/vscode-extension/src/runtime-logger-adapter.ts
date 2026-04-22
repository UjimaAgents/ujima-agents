import type * as vscode from 'vscode';
import type { Logger, LogFields, LogLevel } from '@ujima/runtime-core';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface VscodeLoggerOptions {
  channel: vscode.OutputChannel;
  level?: LogLevel;
  baseFields?: LogFields;
}

export function createVscodeOutputChannelLogger(opts: VscodeLoggerOptions): Logger {
  const minLevel = LEVEL_ORDER[opts.level ?? 'info'];
  return build(opts.channel, minLevel, opts.baseFields ?? {});
}

function build(channel: vscode.OutputChannel, minLevel: number, baseFields: LogFields): Logger {
  function log(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < minLevel) return;
    const merged = { ...baseFields, ...(fields ?? {}) };
    const extra = Object.keys(merged).length
      ? ' ' + Object.entries(merged).map(([k, v]) => `${k}=${fmt(v)}`).join(' ')
      : '';
    channel.appendLine(`${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${extra}`);
  }
  return {
    debug: (m, f) => log('debug', m, f),
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
    child: (childFields: LogFields) => build(channel, minLevel, { ...baseFields, ...childFields }),
  };
}

function fmt(v: unknown): string {
  if (typeof v === 'string') return v.includes(' ') ? JSON.stringify(v) : v;
  if (typeof v === 'number' || typeof v === 'boolean' || v == null) return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
