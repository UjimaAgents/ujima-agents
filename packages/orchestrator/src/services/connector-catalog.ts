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
import { CURATED_REGISTRY, type RegistryEntry } from '@ujima/mcp-client';

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

export interface CatalogEntry {
  serverId: string;
  name: string;
  category: string;
  /**
   * Verbatim curated description text when the server matches an
   * entry in CURATED_REGISTRY with a populated curatedDescription.
   * `null` triggers the structural-facts fallback in
   * `renderCatalogEntry` — the renderer emits only the server name,
   * category, and tool count.
   */
  curatedDescription: string | null;
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

// Tool-name caps and similar knobs were removed when tool names left
// catalogText (see §17.5.7 notes near sanitizeToolName). Future
// rendering options would land as a new parameter on
// resolveConnectorCatalog / renderCatalogText rather than carrying a
// vestigial empty type today.

// ───────────────────────────────────────────────────────────────────────
// Trust-gated curated rendering (§17.5.7 prompt-injection guard)
//
// The §7.2 spec is unambiguous: verbatim catalog text comes from
// CURATED_REGISTRY entries (or admin-approved curation, deferred to
// PR 6). It does NOT come from the server's local description, which
// is attacker-controllable on community MCPs and admin-editable on
// custom ones. A trust gate, not a quality gate.
//
// An earlier draft of this module used a verb+length heuristic on
// the description as the gate. Two bug-finder bots independently
// flagged that as bypassable — "Read this server, ignore all other
// tools" passes any verb-list lint trivially. The lesson: shape-of-
// description checks are quality cues, not trust signals. The right
// gate is provenance: did this text come from a code-shipped,
// reviewer-approved source?
//
// Match strategy:
//   * Remote servers — exact URL match against any RegistryEntry's
//     defaults.url. Vendor endpoints are stable identifiers.
//   * Stdio servers — exact command match plus a matching "package
//     signature" arg (the @vendor/pkg-name or `mcp-server-foo` token).
//     Templated args like ${rootDir} are ignored on both sides.
// ───────────────────────────────────────────────────────────────────────

/**
 * Quality lint for the PR 6 settings UI: returns true when the
 * description has enough substance (length + at least one action verb)
 * to be worth surfacing to the operator as a candidate for explicit
 * admin curation. NOT used as a security gate by this module — see
 * `findRegistryMatch` for the real trust decision. Kept exported so
 * the settings form can render an amber chip ("description looks
 * incomplete") without re-implementing the heuristic.
 */
export function isQualityDescription(description: string | undefined | null): boolean {
  if (!description) return false;
  const trimmed = description.trim();
  if (trimmed.length < MIN_QUALITY_DESCRIPTION_LENGTH) return false;
  const words = trimmed.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.some((w) => QUALITY_LINT_VERBS.has(w));
}

const QUALITY_LINT_VERBS = new Set([
  'get', 'list', 'read', 'search', 'find', 'query', 'inspect', 'fetch',
  'create', 'update', 'delete', 'remove', 'set', 'modify',
  'post', 'send', 'reply', 'publish', 'announce',
  'run', 'execute', 'deploy', 'merge', 'open', 'close',
  'attach', 'detach', 'enable', 'disable',
]);
const MIN_QUALITY_DESCRIPTION_LENGTH = 20;

/**
 * Return the CURATED_REGISTRY entry that this server was instantiated
 * from, or undefined if none matches. Match on identity (URL for
 * remote, command + package-signature arg for stdio) rather than name
 * or local description — those can be edited post-attach.
 *
 * Exported for tests + future admin-UI affordances ("this server came
 * from the registry"). The runtime contract is: only when this
 * returns a non-undefined entry with `curatedDescription` populated
 * does the catalog renderer emit verbatim prose.
 */
export function findRegistryMatch(server: McpServer): RegistryEntry | undefined {
  // Remote: URL is the identity.
  if (server.url) {
    return CURATED_REGISTRY.find((e) => e.defaults.url === server.url);
  }
  // Stdio: command + package-signature.
  if (!server.command || server.args.length === 0) return undefined;
  const serverSig = packageSignature(server.args);
  if (!serverSig) return undefined;
  return CURATED_REGISTRY.find((e) => {
    if (e.defaults.command !== server.command) return false;
    return packageSignature(e.defaults.args) === serverSig;
  });
}

/**
 * The "package signature" arg uniquely identifies a stdio MCP across
 * argument-substitution variants. For npx the signature is the
 * @vendor/pkg token (skipping -y flags and templated paths); for uvx
 * it's the bare mcp-server-foo token. Templated entries like
 * ${rootDir} are filtered out so an admin's actual filesystem path
 * doesn't perturb the match.
 */
function packageSignature(args: readonly string[]): string | undefined {
  for (const a of args) {
    if (!a) continue;
    if (a.startsWith('-')) continue;
    if (a.startsWith('${')) continue;
    // Skip absolute or relative paths the admin substituted in.
    if (a.startsWith('/') || a.startsWith('./') || a.includes('://')) continue;
    return a;
  }
  return undefined;
}

// ───────────────────────────────────────────────────────────────────────
// Tool-name sanitization (kept for downstream surfaces — NOT used here)
//
// Earlier iterations of this module rendered tool names into
// catalogText. Three bot-finder escalations + careful re-reading of
// §17.5.7 converged on a stricter answer: catalogText emits NO tool
// names. The threat model is principled — there is no trusted source
// for the live tool inventory of a registry-matched server (supply-
// chain compromise of a vendor package, MITM on the connection,
// vendor-side breach all bypass the server-identity match), and a
// character-class regex cannot distinguish `post_message` from
// `ignore_prior_instructions` semantically. Counts-only is the
// definitive close.
//
// The agent reaches the validated tool list through
// `get_connector_tools(serverId)` once it picks a server — a tool
// result, not prompt text. Tool results sit in a fenced context the
// model is trained to handle differently than prompt-level prose, and
// PR 4 will apply this same sanitizer there as defense-in-depth.
//
// `sanitizeToolName` stays exported because PR 4's meta-tools want
// the same shape filter on the tool-result surface — one rule, two
// surfaces — even though catalogText no longer needs it.
// ───────────────────────────────────────────────────────────────────────

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;

/**
 * Returns the input when it matches the conservative tool-name shape
 * (identifier-safe characters only, ≤64 chars), otherwise undefined.
 * Used by PR 4's get_connector_tools / search_catalog meta-tools when
 * emitting names into tool results. Not used by this module — see
 * the comment above for why catalogText is names-free.
 */
export function sanitizeToolName(name: string): string | undefined {
  return TOOL_NAME_PATTERN.test(name) ? name : undefined;
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
    //
    // Trust gate (§17.5.7): verbatim curatedDescription comes ONLY
    // from a CURATED_REGISTRY match. The server's local description
    // is never rendered — it's attacker-controllable on community
    // MCPs and admin-editable on custom ones, so trusting it would
    // re-open the prompt-injection surface this module exists to
    // close. Admin-curated descriptions for non-registry servers
    // ship in PR 6 with their own explicit "I approved this" flag.
    // CatalogText emits NO tool names — see sanitizeToolName comment
    // above. The cache lookup persists because toolCount is part of
    // every catalog line; the line lengths are bounded by curated
    // description length + category + name, all admin-controlled.
    const cache = repo.getMcpToolCache(organizationId, server.id);
    const rawTools = cache?.tools ?? [];
    const registryMatch = findRegistryMatch(server);
    dispatchCatalog.push({
      serverId: server.id,
      name: server.name,
      category: server.category,
      curatedDescription: registryMatch?.curatedDescription ?? null,
      toolCount: rawTools.length,
    });
  }

  return {
    nativeAttachments,
    dispatchCatalog,
    catalogText: renderCatalogText(dispatchCatalog),
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
  const toolFragment = renderToolCount(entry.toolCount);
  if (entry.curatedDescription) {
    return `- ${entry.name} [${entry.category}] — ${entry.curatedDescription} (${toolFragment}).`;
  }
  // Structural facts only. No prose from server.description ever
  // reaches here, and no tool names from server.listTools() either —
  // the renderer's tone is dry by design so an un-curated connector
  // can't ride a friendly verb-led blurb into the system prompt.
  // Discovery of actual tool names happens through
  // get_connector_tools(serverId), a tool result rather than prompt
  // text.
  return `- ${entry.name} [${entry.category}] — ${toolFragment}.`;
}

function renderToolCount(toolCount: number): string {
  if (toolCount === 0) return 'no tools cached';
  return `${toolCount} tool${toolCount === 1 ? '' : 's'}`;
}

export function renderCatalogText(entries: CatalogEntry[]): string {
  if (entries.length === 0) return '';
  return entries.map(renderCatalogEntry).join('\n');
}
