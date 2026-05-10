import type { ParsedFilesystemScope, ParsedShellScope } from './approval-scope.js';

function toObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/**
 * Normalized shell fields from a `tool:called` / merged tool payload `args` object
 * (flat or nested under `input`), for terminal-style UI.
 */
export function parseShellToolCallArgs(
  args: Record<string, unknown> | undefined,
): ParsedShellScope | null {
  if (!args) return null;
  const nested = toObject((args as { input?: unknown }).input);
  const command =
    typeof args.command === 'string'
      ? args.command
      : typeof nested?.command === 'string'
        ? nested.command
        : '';
  if (!command) return null;
  const cwdRaw =
    typeof args.cwd === 'string'
      ? args.cwd
      : typeof nested?.cwd === 'string'
        ? nested.cwd
        : '';
  const cwd = cwdRaw || '.';
  const rawArgs = (args as { args?: unknown }).args ?? nested?.args;
  const extra =
    Array.isArray(rawArgs) && rawArgs.length ? rawArgs.map((a) => String(a)) : undefined;
  return extra?.length ? { cwd, command, args: extra } : { cwd, command };
}

/**
 * Normalized filesystem fields from tool call `args` (flat or nested under `input`).
 */
export function parseFilesystemToolCallArgs(
  args: Record<string, unknown> | undefined,
): ParsedFilesystemScope | null {
  if (!args) return null;
  const nested = toObject((args as { input?: unknown }).input);
  const actionRaw =
    typeof args.action === 'string'
      ? args.action
      : typeof nested?.action === 'string'
        ? nested.action
        : '';
  const resourcePath =
    typeof args.resourcePath === 'string'
      ? args.resourcePath
      : typeof nested?.resourcePath === 'string'
        ? nested.resourcePath
        : '';
  if (actionRaw !== 'read' && actionRaw !== 'write') return null;
  if (!resourcePath.trim()) return null;
  const contentRaw = (args as { content?: unknown }).content ?? nested?.content;
  const out: ParsedFilesystemScope = { action: actionRaw, resourcePath };
  if (typeof contentRaw === 'string') out.content = contentRaw;
  return out;
}
