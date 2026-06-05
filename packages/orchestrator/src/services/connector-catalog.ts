// Connector catalog renderer for the V2 spawn path
// (mcp_connector_dispatch_plan.md §7.2 + §17.5.7).
//
// Resolves a member's attachments, partitions them by tier (native vs
// dispatch), and renders the dispatch tier as catalog text for the
// system prompt. The catalog text is what `invoke_connector_tool`
// (PR 4) acts against and what the spawn injects when the
// UJIMA_MCP_DISPATCH flag is on (PR 5).
//
// This module is orphaned in PR 3 — nothing calls it yet. PR 5 wires
// it into `buildMcpToolDefinitionsV2`. Legacy `buildMcpToolDefinitions`
// is tier-blind by design (§3.5 rule 1) and never imports this file.
//
// Two invariants worth naming:
//   1. Un-curated external descriptions are never rendered verbatim.
//      §17.5.7 closes the system-prompt injection surface by falling
//      back to structural facts only (name + tool count + tool name
//      list) when the description fails the quality lint.
//   2. Tier (palette membership) and permission-store grant
//      (approval state) are orthogonal (§9.3). This resolver reads
//      tier only — it does not touch grants.

import type {
  AgentMcpAttachment,
  McpServer,
  McpToolCache,
} from '@ujima/shared';

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

export interface CatalogEntry {
  serverId: string;
  name: string;
  category: string;
  /**
   * Verbatim curated description text when the server's description
   * passes the §17.5.7 quality lint. `null` triggers the structural-
   * facts fallback in `renderCatalogEntry` — the renderer emits only
   * the server name, category, tool count, and tool name preview.
   */
  curatedDescription: string | null;
  toolNamesPreview: string[];
  toolCount: number;
}

export interface NativeAttachment {
  attachment: AgentMcpAttachment;
  server: McpServer;
}

export interface ResolvedCatalog {
  /** Tier='native' attachments — flow into the typed palette path. */
  nativeAttachments: NativeAttachment[];
  /** Tier='dispatch' attachments — flow into the catalog text path. */
  dispatchCatalog: CatalogEntry[];
  /** Pre-rendered block ready for system-prompt injection. */
  catalogText: string;
}

/**
 * Minimal repository surface this module needs. Keeping it narrow
 * lets tests pass a stub and lets the runtime pass the full
 * Repository class without coupling either to changes elsewhere.
 */
export interface ConnectorCatalogRepo {
  listAttachedServersForSpirit(
    organizationId: string,
    memberId: string,
    role: 'worker' | 'supervisor',
  ): { attachment: AgentMcpAttachment; server: McpServer }[];
  getMcpToolCache(organizationId: string, serverId: string): McpToolCache | null;
}

export interface RenderOptions {
  /**
   * Cap on the number of tool names emitted per entry. Defaults to 5,
   * which keeps the per-entry catalog line short enough that ~50
   * dispatch servers still fit in a few thousand tokens. Higher caps
   * stop being useful — the model can call `get_connector_tools` for
   * the full list once it picks a server.
   */
  toolNamePreviewLimit?: number;
}

// ───────────────────────────────────────────────────────────────────────
// Description quality lint (§17.5.7 prompt-injection guard)
// ───────────────────────────────────────────────────────────────────────

const ACTION_VERBS = new Set([
  'get', 'list', 'read', 'search', 'find', 'query', 'inspect', 'fetch',
  'create', 'update', 'delete', 'remove', 'set', 'modify',
  'post', 'send', 'reply', 'publish', 'announce',
  'run', 'execute', 'deploy', 'merge', 'open', 'close',
  'attach', 'detach', 'enable', 'disable',
]);

const MIN_CURATED_DESCRIPTION_LENGTH = 20;

/**
 * Returns true when `description` passes the §17.5.7 quality lint and
 * is safe to render verbatim. Failures (too short, no verb, empty,
 * undefined) trigger the structural-facts fallback so an attacker-
 * controlled MCP self-description never reaches the system prompt.
 *
 * Exported because PR 6's settings UI will run the same check at
 * attach-time to surface an amber "needs curation" chip before the
 * server ever ships catalog text.
 */
export function isQualityDescription(description: string | undefined | null): boolean {
  if (!description) return false;
  const trimmed = description.trim();
  if (trimmed.length < MIN_CURATED_DESCRIPTION_LENGTH) return false;
  // Verb match is case-insensitive and word-boundary-aware so
  // "Lifecycle" doesn't falsely pass the "list" rule.
  const words = trimmed.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.some((w) => ACTION_VERBS.has(w));
}

// ───────────────────────────────────────────────────────────────────────
// Resolver
// ───────────────────────────────────────────────────────────────────────

/**
 * Partition an agent's attachments into native (typed palette) and
 * dispatch (catalog text), and pre-render the dispatch catalog.
 *
 * The role filter is delegated to `listAttachedServersForSpirit` so
 * scope ('worker' | 'supervisor' | 'both') interacts with role
 * exactly as it does in the legacy spawn path.
 */
export function resolveConnectorCatalog(
  repo: ConnectorCatalogRepo,
  organizationId: string,
  memberId: string,
  role: 'worker' | 'supervisor',
  options: RenderOptions = {},
): ResolvedCatalog {
  const pairs = repo.listAttachedServersForSpirit(organizationId, memberId, role);

  const nativeAttachments: NativeAttachment[] = [];
  const dispatchCatalog: CatalogEntry[] = [];

  for (const { attachment, server } of pairs) {
    if (attachment.tier === 'native') {
      nativeAttachments.push({ attachment, server });
      continue;
    }
    // Dispatch tier — build a CatalogEntry. Tool inventory comes from
    // the persisted cache; an empty list (server never tested) yields
    // toolCount=0, which renderCatalogEntry surfaces honestly rather
    // than hiding.
    const cache = repo.getMcpToolCache(organizationId, server.id);
    const toolNames = (cache?.tools ?? []).map((t) => t.name);
    dispatchCatalog.push({
      serverId: server.id,
      name: server.name,
      category: server.category,
      curatedDescription: isQualityDescription(server.description)
        ? server.description.trim()
        : null,
      toolNamesPreview: toolNames.slice(0, options.toolNamePreviewLimit ?? 5),
      toolCount: toolNames.length,
    });
  }

  return {
    nativeAttachments,
    dispatchCatalog,
    catalogText: renderCatalogText(dispatchCatalog, options),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Renderer
// ───────────────────────────────────────────────────────────────────────

/**
 * Render one CatalogEntry as a single line. Curated entries get the
 * description verbatim; un-curated entries get structural facts only
 * (name + category + tool count + tool name preview). This is the
 * §17.5.7 sanitization point — the same helper is meant to be reused
 * by `search_catalog` results in PR 4 so one rule covers both
 * surfaces (system prompt + tool result).
 */
export function renderCatalogEntry(entry: CatalogEntry): string {
  const preview = entry.toolNamesPreview.length > 0
    ? entry.toolNamesPreview.join(', ') +
      (entry.toolCount > entry.toolNamesPreview.length ? ', …' : '')
    : '(no tools cached)';

  if (entry.curatedDescription) {
    return `- ${entry.name} [${entry.category}] — ${entry.curatedDescription} Tools: ${preview}.`;
  }
  // Structural facts only. No prose from server.description ever
  // reaches here — the renderer's tone is dry by design so an
  // un-curated connector can't ride a friendly verb-led blurb into
  // the system prompt.
  return `- ${entry.name} [${entry.category}] — ${entry.toolCount} tool${entry.toolCount === 1 ? '' : 's'}: ${preview}.`;
}

export function renderCatalogText(
  entries: CatalogEntry[],
  _options: RenderOptions = {},
): string {
  if (entries.length === 0) return '';
  return entries.map(renderCatalogEntry).join('\n');
}
