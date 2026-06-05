import { createHash } from 'node:crypto';
import { jsonSchema, type FlexibleSchema, type ToolSet } from 'ai';
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

// -----------------------------------------------------------------------
// Native palette token estimator
// (mcp_connector_dispatch_plan.md §7.3)
//
// Conservative chars/token divisors per model family. The originating
// 60-tool overflow bug was Gemini-specific, so the Gemini divisor sits
// below the Anthropic/OpenAI one — tiktoken's chars/3.5 underestimates
// Gemini's tokenizer by ~25% in our observation, and a budget meter
// that under-reports on the model where over-budget is a hard failure
// is worse than useless. When the vendor is unknown, we use the
// smallest divisor (most conservative — predicts the most tokens for
// the same chars) so the meter errs on the safe side.
// -----------------------------------------------------------------------

export type ModelVendor = 'anthropic' | 'openai' | 'gemini';

const CHARS_PER_TOKEN: Record<ModelVendor, number> = {
  anthropic: 3.5,
  openai: 3.5,
  gemini: 2.5,
};

const CONSERVATIVE_CHARS_PER_TOKEN = 2.5;

export const DEFAULT_PALETTE_TOKEN_BUDGET = 8000;

interface ToolDefForEstimate {
  description?: string;
  inputSchema?: unknown;
  parameters?: unknown;
}

export function estimateToolPaletteTokens(
  toolDefs: ToolSet,
  modelVendor?: ModelVendor,
): number {
  let totalChars = 0;
  for (const [name, raw] of Object.entries(toolDefs)) {
    totalChars += name.length;
    const def = raw as ToolDefForEstimate;
    if (typeof def.description === 'string') {
      totalChars += def.description.length;
    }
    // The AI SDK exposes the JSON Schema as either `inputSchema` (MCP-style
    // descriptors we threaded through) or `parameters` (native tools). Both
    // are read defensively — a non-serialisable schema falls through to
    // 0 chars rather than throwing during a settings-page render.
    const schema = def.inputSchema ?? def.parameters;
    if (schema !== undefined && schema !== null) {
      try {
        totalChars += JSON.stringify(schema).length;
      } catch {
        // Skip — a non-serialisable schema contributes 0 to the estimate.
        // Better than crashing the meter; the V2 spawn path's spill
        // (§7.4 step 5) is the runtime safety net regardless.
      }
    }
  }
  const divisor = modelVendor
    ? CHARS_PER_TOKEN[modelVendor]
    : CONSERVATIVE_CHARS_PER_TOKEN;
  return Math.ceil(totalChars / divisor);
}
