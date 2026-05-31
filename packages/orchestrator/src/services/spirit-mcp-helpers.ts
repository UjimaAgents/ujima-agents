import { createHash } from 'node:crypto';
import { jsonSchema, type FlexibleSchema } from 'ai';
import { z } from 'zod';

export interface McpServerSummary {
  serverName: string;
  serverId: string;
  toolNames: string[];
}

export function sanitizeMcpNamespace(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'mcp';
}

// Trim the heaviest attached MCP server's tools out of a ToolSet.
// Used by the runtime SchemaTooLargeError recovery path: when
// Gemini rejects the combined tool schema with "too many states",
// callers ask this helper to drop the largest contributor and
// retry. Built-in tools (channel.*, self.*, view, ls, …) live
// outside the `mcp__` namespace and stay untouched.
//
// Lives here (not in the call sites) so the wake-run path
// (ai-service.ts) and the direct-spirit path
// (spirit-agent-run.ts) drop the same shape — adding a new
// recovery heuristic means editing one function.
import type { ToolSet } from 'ai';

export interface AttachedMcpServerSummary {
  serverName: string;
  serverId: string;
  toolNames: string[];
}

export function dropHeaviestAttachedMcp(
  toolDefs: ToolSet,
  attachedMcpServers: readonly AttachedMcpServerSummary[],
): { serverName: string; toolNames: string[]; toolDefs: ToolSet } | null {
  if (attachedMcpServers.length === 0) return null;
  const heaviest = [...attachedMcpServers].sort(
    (a, b) => b.toolNames.length - a.toolNames.length,
  )[0];
  if (!heaviest || heaviest.toolNames.length === 0) return null;
  const nsSlug = buildMcpNamespace(heaviest.serverName, heaviest.serverId);
  const prefix = `mcp__${nsSlug}__`;
  const filtered: ToolSet = {};
  for (const [key, def] of Object.entries(toolDefs)) {
    if (!key.startsWith(prefix)) filtered[key] = def;
  }
  return {
    serverName: heaviest.serverName,
    toolNames: heaviest.toolNames,
    toolDefs: filtered,
  };
}

export function buildMcpNamespace(name: string, serverId: string): string {
  const hash = shortStableHash(serverId);
  const maxNameLength = 40 - hash.length - 1;
  const nameSlug = sanitizeMcpNamespace(name).slice(0, maxNameLength).replace(/_+$/g, '');
  return `${nameSlug || 'mcp'}_${hash}`;
}

export function sanitizeMcpToolName(name: string): string {
  return name
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'tool';
}

export function uniqueMcpToolId(
  baseToolId: string,
  serverId: string,
  toolName: string,
  usedToolIds: Set<string>,
): string {
  if (!usedToolIds.has(baseToolId)) {
    usedToolIds.add(baseToolId);
    return baseToolId;
  }

  const suffix = shortStableHash(`${serverId}:${toolName}`);
  let candidate = `${baseToolId}__${suffix}`;
  let attempt = 2;
  while (usedToolIds.has(candidate)) {
    candidate = `${baseToolId}__${suffix}_${attempt}`;
    attempt += 1;
  }
  usedToolIds.add(candidate);
  return candidate;
}

export function shortStableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

/** Prefer server JSON Schema; fall back to a permissive record when absent. */
export function mcpToolInputSchema(
  schema: Record<string, unknown> | undefined,
): FlexibleSchema<Record<string, unknown>> {
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    return jsonSchema<Record<string, unknown>>(schema as never);
  }
  return z.record(z.string(), z.unknown());
}
