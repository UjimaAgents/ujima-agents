import type { AgentPermissions } from '@ujima/shared';
import { findRegistryEntry, type RegistryEntry } from './registry';

export type PermissionPreset = 'read_only' | 'read_write' | 'full';

export interface PresetOptions {
  discoveredTools?: string[];
  rateLimit?: AgentPermissions['rate_limit'];
}

const DEFAULT_RATE_LIMIT: AgentPermissions['rate_limit'] = {
  calls_per_minute: 30,
  max_session_tokens: 100_000,
};

const READ_VERBS = new Set([
  'get',
  'list',
  'read',
  'search',
  'find',
  'query',
  'inspect',
  'snapshot',
  'describe',
  'browse',
  'fetch',
  'view',
]);

export function buildPermissionPreset(
  registryId: string,
  preset: PermissionPreset,
  opts: PresetOptions = {},
): AgentPermissions {
  const entry = findRegistryEntry(registryId);
  if (!entry) throw new Error(`Unknown registry entry: "${registryId}"`);
  return applyPreset(entry, preset, opts);
}

export function applyPreset(
  entry: RegistryEntry,
  preset: PermissionPreset,
  opts: PresetOptions = {},
): AgentPermissions {
  const destructive = entry.knownDestructiveTools ?? [];
  const tools = normalizeList(opts.discoveredTools);
  const rateLimit = opts.rateLimit ?? DEFAULT_RATE_LIMIT;

  if (preset === 'full') {
    return {
      allowed_tools: tools,
      blocked_tools: [],
      rate_limit: rateLimit,
    };
  }

  if (preset === 'read_only') {
    const reads = tools.filter(isReadTool);
    return {
      allowed_tools: reads,
      blocked_tools: unique([...tools.filter((t) => !isReadTool(t)), ...destructive]),
      rate_limit: rateLimit,
    };
  }

  // read_write: everything except flagged destructive
  return {
    allowed_tools: tools.filter((t) => !destructive.includes(t)),
    blocked_tools: unique(destructive),
    rate_limit: rateLimit,
  };
}

export function describePreset(preset: PermissionPreset): string {
  switch (preset) {
    case 'read_only':
      return 'Read-only: only get_/list_/search_ style tools. Destructive tools always blocked.';
    case 'read_write':
      return 'Read & write: everything except tools flagged as destructive.';
    case 'full':
      return 'Full access: every tool allowed. Use with caution.';
  }
}

export function isDestructive(entry: RegistryEntry, toolName: string): boolean {
  return (entry.knownDestructiveTools ?? []).includes(toolName);
}

function isReadTool(name: string): boolean {
  const tokens = name.toLowerCase().split(/[_\-/]/);
  return tokens.some((t) => READ_VERBS.has(t));
}

function normalizeList(tools: string[] | undefined): string[] {
  if (!tools || tools.length === 0) return [];
  return unique(tools);
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
