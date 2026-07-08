import type { ParsedFilesystemScope, ParsedGrepScope, ParsedShellScope } from './approval-scope.js';

export function toObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function nestedInput(args: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return args ? toObject((args as { input?: unknown }).input) : undefined;
}

export function readStringArg(
  args: Record<string, unknown> | undefined,
  nested: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = args?.[key];
  if (typeof value === 'string') return value;
  const nestedValue = nested?.[key];
  return typeof nestedValue === 'string' ? nestedValue : undefined;
}

export function readNumberArg(
  args: Record<string, unknown> | undefined,
  nested: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = args?.[key];
  if (typeof value === 'number') return value;
  const nestedValue = nested?.[key];
  return typeof nestedValue === 'number' ? nestedValue : undefined;
}

export function readIntegerArg(
  args: Record<string, unknown> | undefined,
  nested: Record<string, unknown> | undefined,
  ...keys: string[]
): number | undefined {
  for (const source of [args, nested]) {
    if (!source) continue;
    for (const key of keys) {
      const v = source[key];
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const n = Number.parseInt(v, 10);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return undefined;
}

export function readBooleanArg(
  args: Record<string, unknown> | undefined,
  nested: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = args?.[key];
  if (typeof value === 'boolean') return value;
  const nestedValue = nested?.[key];
  return typeof nestedValue === 'boolean' ? nestedValue : undefined;
}

export function readStringArrayArg(
  args: Record<string, unknown> | undefined,
  nested: Record<string, unknown> | undefined,
  key: string,
): string[] | undefined {
  const value = args?.[key];
  const candidate = Array.isArray(value) ? value : nested?.[key];
  return Array.isArray(candidate) && candidate.length ? candidate.map((item) => String(item)) : undefined;
}

/**
 * Normalized shell fields from a `tool:called` / merged tool payload `args` object
 * (flat or nested under `input`), for terminal-style UI.
 */
export function parseShellToolCallArgs(
  args: Record<string, unknown> | undefined,
): ParsedShellScope | null {
  if (!args) return null;
  const nested = nestedInput(args);
  const command = readStringArg(args, nested, 'command') ?? '';
  const cwd = readStringArg(args, nested, 'cwd') || '.';
  const extra = readStringArrayArg(args, nested, 'args');
  return extra?.length ? { cwd, command, args: extra } : { cwd, command };
}

/**
 * Normalized filesystem fields from tool call `args` (flat or nested under `input`).
 */
export function parseFilesystemToolCallArgs(
  args: Record<string, unknown> | undefined,
): ParsedFilesystemScope | null {
  if (!args) return null;
  const nested = nestedInput(args);
  const actionRaw = readStringArg(args, nested, 'action') ?? '';
  const resourcePath =
    readStringArg(args, nested, 'file_path') ??
    readStringArg(args, nested, 'resourcePath') ??
    '';
  if (actionRaw !== 'read' && actionRaw !== 'write') return null;
  if (!resourcePath.trim()) return null;
  const offsetRaw = readNumberArg(args, nested, 'offset');
  const limitRaw = readNumberArg(args, nested, 'limit');
  const out: ParsedFilesystemScope = { action: actionRaw, resourcePath };
  if (typeof offsetRaw === 'number' && Number.isFinite(offsetRaw)) out.offset = offsetRaw;
  if (typeof limitRaw === 'number' && Number.isFinite(limitRaw)) out.limit = limitRaw;
  const patchRaw = readStringArg(args, nested, 'patch');
  const contentRaw = readStringArg(args, nested, 'content');
  if (patchRaw !== undefined) out.patch = patchRaw;
  if (contentRaw !== undefined) out.content = contentRaw;
  return out;
}

/**
 * Normalized grep fields from tool call `args` (flat or nested under `input`).
 */
export function parseGrepToolCallArgs(
  args: Record<string, unknown> | undefined,
): ParsedGrepScope | null {
  if (!args) return null;
  const nested = nestedInput(args);
  const query = readStringArg(args, nested, 'query') ?? '';
  if (!query.trim()) return null;
  const resourcePath =
    readStringArg(args, nested, 'file_path') ||
    readStringArg(args, nested, 'resourcePath') ||
    readStringArg(args, nested, 'path') ||
    '';
  if (!resourcePath.trim()) return null;
  const limitRaw = readNumberArg(args, nested, 'limit');
  const ignoreCaseRaw = readBooleanArg(args, nested, 'ignoreCase');
  const out: ParsedGrepScope = { query, resourcePath };
  if (typeof limitRaw === 'number' && Number.isFinite(limitRaw)) out.limit = limitRaw;
  if (typeof ignoreCaseRaw === 'boolean') out.ignoreCase = ignoreCaseRaw;
  return out;
}

export interface ParsedWebSearchScope {
  query: string;
  site?: string;
  limit?: number;
}

/**
 * Normalized web search fields from tool call `args` (flat or nested under `input`).
 */
export function parseWebSearchToolCallArgs(
  args: Record<string, unknown> | undefined,
): ParsedWebSearchScope | null {
  if (!args) return null;
  const nested = nestedInput(args);
  const query = readStringArg(args, nested, 'query') ?? '';
  if (!query.trim()) return null;
  const siteRaw = readStringArg(args, nested, 'site') ?? '';
  const limitRaw = readNumberArg(args, nested, 'limit');
  const out: ParsedWebSearchScope = { query };
  if (siteRaw.trim()) out.site = siteRaw.trim();
  if (typeof limitRaw === 'number' && Number.isFinite(limitRaw)) out.limit = limitRaw;
  return out;
}
