// Discovery tools (mcp_connector_dispatch_plan.md §17.5.5 / PR 11).
//
// Two deterministic tools that ship the discovery escalation without
// the IT-guy agent. The asking agent searches, picks, and requests an
// attachment in its own trajectory — one LLM, one consent chain.
//
//   `search_catalog(query)` — scores org's MCP servers ∪ CURATED_REGISTRY
//   `request_attachment(serverId, target?, targetId?, reason)` — fires
//      the §17.5.6 two-grant approval card and writes the attachment
//      row on approval. NO action invocation; that's a separate
//      decision the operator makes on the same card.
//
// Both tools are registered next to `get_connector_tools` /
// `invoke_connector_tool` in V2 spawn (always present). With the
// dispatch flag off the legacy spawn never imports this file.
//
// The §17.5.7 invariant — un-curated external prose never reaches the
// model verbatim — applies to BOTH tools. search_catalog results go
// through `renderCatalogEntry(entry, 'search-result')`, the same
// helper the system-prompt catalog uses; request_attachment's
// approval card surfaces the asking agent's `reason` (high-trust,
// from the agent's own trajectory) but never re-renders the
// server's free-text description.

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { CURATED_REGISTRY, type RegistryEntry } from '@ujima/mcp-client';
import type {
  AgentMcpAttachment,
  ChannelMcpAttachment,
  McpServer,
  McpToolCache,
  SpiritRole,
} from '@ujima/shared';
import {
  findRegistryMatch,
  renderCatalogEntry,
  safeServerLabel,
  type AttachmentSource,
  type CatalogEntry,
} from '../services/connector-catalog.js';
import type { ApprovalRequest } from '@ujima/shared';
import type { ConnectorAuditWriter } from '../services/connector-audit.js';
import {
  toModelToolErrorOutput,
  toModelToolOutput,
} from '../services/tool-loop-result.js';
import type { ToolService } from '../services/tool-service.js';

// ───────────────────────────────────────────────────────────────────────
// Repository surface
// ───────────────────────────────────────────────────────────────────────

export interface DiscoveryToolRepo {
  /** Every server configured for the org — the search corpus floor. */
  listMcpServers(organizationId: string): McpServer[];
  getMcpServer(organizationId: string, serverId: string): McpServer | null;
  getMcpToolCache(
    organizationId: string,
    serverId: string,
  ): McpToolCache | null;
  /**
   * What the asking agent ALREADY has in its effective set — drives
   * the `isAttachedToEffectiveSet` flag so the agent can tell at a
   * glance whether to call `invoke_connector_tool` directly or
   * `request_attachment` first.
   */
  listAttachedServersForSpirit(
    organizationId: string,
    memberId: string,
    role: 'worker' | 'supervisor',
  ): { attachment: AgentMcpAttachment; server: McpServer }[];
  listChannelMcpAttachmentsForMember(
    organizationId: string,
    memberId: string,
  ): ChannelMcpAttachment[];
  /** Persist the attachment row on approval. */
  saveAgentMcpAttachment(attachment: AgentMcpAttachment): AgentMcpAttachment;
  saveChannelMcpAttachment(
    attachment: ChannelMcpAttachment,
  ): ChannelMcpAttachment;
}

export interface DiscoveryToolDeps {
  organizationId: string;
  memberId: string;
  runId: string;
  threadId?: string;
  taskSessionId?: string;
  spiritRole: SpiritRole;
  tools: ToolService;
  repo: DiscoveryToolRepo;
  audit?: ConnectorAuditWriter;
  /**
   * Direct approval-request callback so `request_attachment` can
   * fire a §17.5.6 approval card without routing through
   * ToolService.invoke (which would apply governance policy
   * intended for tool invocations, not attachment requests).
   * Attachment is ALWAYS an operator decision — the policy gate
   * is exactly one card click, no auto-approve case.
   *
   * Optional so legacy callers (PR 8 V2 callsites, tests that
   * don't exercise the discovery path) don't have to wire one;
   * the tool's execute returns a clean error result when the
   * callback is absent so the model gets a deterministic message
   * instead of an unhandled exception.
   */
  requestAttachmentApproval?: (input: AttachmentApprovalRequest) => ApprovalRequest;
}

export interface AttachmentApprovalRequest {
  organizationId: string;
  runId: string;
  toolCallId: string;
  requestedBy: string;
  serverId: string;
  /**
   * PR 11 (bot fix) — human-readable label for the server. Resolved
   * at request_attachment time from either the org's existing MCP
   * row (safeServerLabel) or the curated registry entry (entry.name).
   * Persisted in the approval payload so the frontend approval card
   * shows "Fetch" instead of opaque ids like "registry:fetch".
   */
  serverDisplayName: string;
  target: 'agent' | 'channel';
  targetId: string;
  reason: string;
  approvalId: string;
}

export interface DiscoveryToolSet {
  search_catalog: Tool;
  request_attachment: Tool;
}

// ───────────────────────────────────────────────────────────────────────
// Input schemas
// ───────────────────────────────────────────────────────────────────────

const SearchCatalogSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Free-text search for an MCP connector that could solve the ' +
        "asking agent's current need. Searches the org's configured " +
        'MCPs plus the Ujima-curated catalog by name, tag, category, ' +
        'and description keywords. Returns at most 10 matches.',
    ),
});

const RequestAttachmentSchema = z.object({
  server_id: z
    .string()
    .min(1)
    .describe(
      'serverId from a search_catalog match. Must reference an MCP ' +
        'that exists in the org OR appears in the Ujima-curated catalog.',
    ),
  target: z
    .enum(['agent', 'channel'])
    .optional()
    .describe(
      "Attachment scope. 'agent' (default) attaches to the asking " +
        "agent only — least privilege. 'channel' attaches to the " +
        "specified channel; every member inherits the MCP.",
    ),
  target_id: z
    .string()
    .optional()
    .describe(
      'Channel id when target=channel. Defaults to the asking ' +
        "agent's own id when target=agent (or omitted entirely).",
    ),
  reason: z
    .string()
    .min(1)
    .max(1000)
    .describe(
      'Why the agent needs this attachment. Becomes part of the ' +
        'operator-visible approval card. Be specific — the operator ' +
        "is reading this to decide whether to grant.",
    ),
});

/**
 * PR 11 (bot fix) — resolves a §17.5.7-safe human-readable label
 * for any serverId the agent might pass to request_attachment.
 *
 * Real org serverId → safeServerLabel(server, registryMatch). If
 *   the server matches a CURATED_REGISTRY entry, the entry's
 *   canonical name; otherwise the opaque "Custom MCP (id-prefix)".
 * registry:<id>      → entry.name from CURATED_REGISTRY lookup.
 * Unknown id         → the raw id as the last-ditch fallback. This
 *   path means the agent passed a serverId that doesn't exist
 *   anywhere; the approval card will surface that visibly and the
 *   operator can reject.
 *
 * Encoded into the approval payload so the frontend card renders
 * the label instead of opaque ids like "registry:fetch".
 */
function resolveServerDisplayName(
  deps: DiscoveryToolDeps,
  serverId: string,
): string {
  if (serverId.startsWith('registry:')) {
    const id = serverId.slice('registry:'.length);
    const entry = CURATED_REGISTRY.find((e) => e.id === id);
    return entry?.name ?? serverId;
  }
  const server = deps.repo.getMcpServer(deps.organizationId, serverId);
  if (!server) return serverId;
  return safeServerLabel(server, findRegistryMatch(server)).name;
}

// ───────────────────────────────────────────────────────────────────────
// search_catalog — scoring
// ───────────────────────────────────────────────────────────────────────

interface ScoredMatch {
  entry: CatalogEntry;
  isAttachedToEffectiveSet: boolean;
  score: number;
}

const SEARCH_TOP_K = 10;

// Score buckets — kept sparse so adjacent buckets don't tie. A name
// hit always beats a tag hit, a tag hit always beats a category hit,
// etc. Within a bucket multiple hits stack so a multi-word query that
// matches multiple tags wins over a single-tag match. The constants
// are tuned for short queries (1-3 words) — longer queries naturally
// pile up more keyword hits and surface broader matches.
const SCORE_NAME_EXACT = 100;
const SCORE_NAME_PARTIAL = 40;
const SCORE_TAG_HIT = 25;
const SCORE_CATEGORY_HIT = 15;
const SCORE_DESCRIPTION_HIT = 5;

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function scoreEntry(
  query: string,
  name: string,
  tags: string[],
  category: string,
  description: string | null,
): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const qTokens = tokenize(q);
  if (qTokens.length === 0) return 0;
  let score = 0;
  const nameLower = name.toLowerCase();
  if (nameLower === q) score += SCORE_NAME_EXACT;
  else if (nameLower.includes(q)) score += SCORE_NAME_PARTIAL;
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  for (const t of qTokens) {
    if (tagSet.has(t)) score += SCORE_TAG_HIT;
  }
  if (category.toLowerCase().includes(q)) score += SCORE_CATEGORY_HIT;
  if (description) {
    const dLower = description.toLowerCase();
    for (const t of qTokens) {
      if (dLower.includes(t)) score += SCORE_DESCRIPTION_HIT;
    }
  }
  return score;
}

/**
 * Pool: every org MCP server ∪ every CURATED_REGISTRY entry, deduped
 * by registry-id-match (an org server that instantiated from registry
 * entry "fetch" is the same row as the registry "fetch" entry — we
 * keep the org row because it carries the concrete serverId the
 * agent can pass to `request_attachment` and `invoke_connector_tool`).
 *
 * Registry-only entries (never attached in this org) get a synthetic
 * serverId of the form `registry:<entryId>` so the request_attachment
 * caller can hand it back unmodified; the tool's resolver
 * (handleRequestAttachment) recognises the prefix and instantiates
 * from the registry instead of looking up an existing row.
 */
export function buildSearchCorpus(
  orgServers: McpServer[],
): {
  serverId: string;
  name: string;
  tags: string[];
  category: string;
  curatedDescription: string | null;
  registryMatch: RegistryEntry | undefined;
  // The concrete server object — present for org MCPs, absent for
  // registry-only entries we haven't instantiated yet.
  server: McpServer | undefined;
}[] {
  const out: {
    serverId: string;
    name: string;
    tags: string[];
    category: string;
    curatedDescription: string | null;
    registryMatch: RegistryEntry | undefined;
    server: McpServer | undefined;
  }[] = [];
  const matchedRegistryIds = new Set<string>();
  for (const server of orgServers) {
    const registryMatch = findRegistryMatch(server);
    if (registryMatch) matchedRegistryIds.add(registryMatch.id);
    const safe = safeServerLabel(server, registryMatch);
    out.push({
      serverId: server.id,
      name: safe.name,
      tags: registryMatch?.tags ?? [],
      category: safe.category,
      curatedDescription: registryMatch?.curatedDescription ?? null,
      registryMatch,
      server,
    });
  }
  for (const entry of CURATED_REGISTRY) {
    if (matchedRegistryIds.has(entry.id)) continue;
    out.push({
      serverId: `registry:${entry.id}`,
      name: entry.name,
      tags: entry.tags,
      category: entry.category,
      curatedDescription: entry.curatedDescription ?? null,
      registryMatch: entry,
      server: undefined,
    });
  }
  return out;
}

function resolveEffectiveSet(
  deps: DiscoveryToolDeps,
): Set<string> {
  const effective = new Set<string>();
  for (const { server } of deps.repo.listAttachedServersForSpirit(
    deps.organizationId,
    deps.memberId,
    deps.spiritRole,
  )) {
    effective.add(server.id);
  }
  for (const att of deps.repo.listChannelMcpAttachmentsForMember(
    deps.organizationId,
    deps.memberId,
  )) {
    // Scope filter mirrors the §17.5.3 union step — the asking agent
    // only "has" channel attachments that match its current role.
    if (att.scope === deps.spiritRole || att.scope === 'both') {
      effective.add(att.mcpServerId);
    }
  }
  return effective;
}

// ───────────────────────────────────────────────────────────────────────
// Tool factory
// ───────────────────────────────────────────────────────────────────────

export function buildDiscoveryTools(deps: DiscoveryToolDeps): DiscoveryToolSet {
  return {
    search_catalog: tool({
      description:
        "Search the org's MCP catalog plus the Ujima-curated marketplace " +
        "for connectors that could solve the asking agent's current need. " +
        "Returns up to 10 matches with an `isAttachedToEffectiveSet` flag " +
        "so the asking agent can tell whether to invoke directly or " +
        "request_attachment first. No side effects.",
      inputSchema: SearchCatalogSchema,
      execute: async (rawArgs) => {
        const args = SearchCatalogSchema.parse(rawArgs);
        try {
          const corpus = buildSearchCorpus(
            deps.repo.listMcpServers(deps.organizationId),
          );
          const effective = resolveEffectiveSet(deps);
          const scored: ScoredMatch[] = [];
          for (const candidate of corpus) {
            const score = scoreEntry(
              args.query,
              candidate.name,
              candidate.tags,
              candidate.category,
              candidate.curatedDescription,
            );
            if (score <= 0) continue;
            // Tool-count from cache. Registry-only entries with no
            // concrete server show toolCount=0 ("not tested in this
            // org yet") which renderCatalogEntry handles via the
            // 'no tools cached' fallback.
            const cache = candidate.server
              ? deps.repo.getMcpToolCache(
                  deps.organizationId,
                  candidate.server.id,
                )
              : null;
            const toolCount = cache?.tools.length ?? 0;
            // Effective-set check: only org-server matches can be
            // already-attached; registry-only synthetic ids never are.
            const isAttachedToEffectiveSet =
              candidate.server !== undefined &&
              effective.has(candidate.server.id);
            // Source on the rendered entry uses 'agent' as the
            // benign default — these are SEARCH results, not yet
            // attached anywhere. The (via channel) marker would be
            // misleading.
            const source: AttachmentSource = { kind: 'agent' };
            scored.push({
              entry: {
                serverId: candidate.serverId,
                name: candidate.name,
                category: candidate.category,
                curatedDescription: candidate.curatedDescription,
                toolCount,
                source,
              },
              isAttachedToEffectiveSet,
              score,
            });
          }
          scored.sort((a, b) => b.score - a.score);
          const top = scored.slice(0, SEARCH_TOP_K);
          deps.audit?.catalogSearch({
            organizationId: deps.organizationId,
            actorMemberId: deps.memberId,
            runId: deps.runId,
            query: args.query.trim(),
            matchCount: top.length,
          });
          return toModelToolOutput({
            ok: true,
            output: {
              matches: top.map((m) => ({
                serverId: m.entry.serverId,
                name: m.entry.name,
                category: m.entry.category,
                curatedDescription: m.entry.curatedDescription,
                toolCount: m.entry.toolCount,
                isAttachedToEffectiveSet: m.isAttachedToEffectiveSet,
                // The same §17.5.7-sanitised one-liner the system
                // prompt would emit — gives the model a compact
                // human-readable summary alongside the structured
                // fields. One sanitization policy, two surfaces.
                renderedLine: renderCatalogEntry(m.entry, 'search-result', {
                  isAttachedToEffectiveSet: m.isAttachedToEffectiveSet,
                }),
              })),
              hasMore: scored.length > SEARCH_TOP_K,
              queryEcho: args.query.trim(),
            },
          });
        } catch (err) {
          return toModelToolErrorOutput(err);
        }
      },
    }),

    request_attachment: tool({
      description:
        "Ask the operator to attach an MCP connector to either the asking " +
        "agent (default) or a channel. Surfaces an approval card with the " +
        "agent's reason and a separate first-action grant (§17.5.6). On " +
        "approval the attachment row is written; rejection blocks both " +
        "the attach and the first action. This tool does NOT invoke any " +
        "MCP tool by itself — invocation is a separate decision on the " +
        "same card.",
      inputSchema: RequestAttachmentSchema,
      execute: async (rawArgs, { toolCallId }) => {
        const args = RequestAttachmentSchema.parse(rawArgs);
        try {
          // Default target=self per §17.5.6 "least privilege" — the
          // operator can still upgrade to channel via the approval
          // card if they want to broadcast the attachment.
          const target = args.target ?? 'agent';
          const targetId =
            args.target_id ??
            (target === 'agent' ? deps.memberId : '');
          if (target === 'channel' && !targetId) {
            return toModelToolErrorOutput(
              new Error(
                "target='channel' requires target_id (the channel id)",
              ),
            );
          }
          // Fire the §17.5.6 approval card directly through the
          // ApprovalService callback. Attachment is ALWAYS operator-
          // gated so there's no auto-approve case to route through
          // the standard ToolService policy gate; calling the
          // approval surface directly keeps the wiring narrow and
          // sidesteps the governance machinery that's intended for
          // tool invocations rather than attachment requests.
          if (!deps.requestAttachmentApproval) {
            return toModelToolErrorOutput(
              new Error(
                'request_attachment is unavailable in this runtime ' +
                  '(no approval surface wired). Ask the operator to ' +
                  'attach the connector via the settings UI instead.',
              ),
            );
          }
          // Resolve a human-readable label for the approval card.
          // For real org serverIds, use safeServerLabel against the
          // server row (§17.5.7 sanitized). For registry:<id>
          // synthetic ids (marketplace-only entries), use the
          // curated registry entry's name. Both branches stay inside
          // §17.5.7 — server.name / server.description are never
          // exposed to the operator without going through the safe
          // label or curated-registry gate first.
          const serverDisplayName = resolveServerDisplayName(
            deps,
            args.server_id,
          );
          const approvalId = `apr_${randomUUID()}`;
          const approval = deps.requestAttachmentApproval({
            organizationId: deps.organizationId,
            runId: deps.runId,
            toolCallId,
            requestedBy: deps.memberId,
            serverId: args.server_id,
            serverDisplayName,
            target,
            targetId,
            reason: args.reason,
            approvalId,
          });
          deps.audit?.attachmentRequestCreated({
            organizationId: deps.organizationId,
            actorMemberId: deps.memberId,
            runId: deps.runId,
            serverId: args.server_id,
            target,
            targetId,
            reason: args.reason,
            approvalId: approval.id,
          });
          return toModelToolOutput({
            ok: true,
            requiresApprovalId: approval.id,
            output: {
              status: 'waiting_for_approval',
              approvalId: approval.id,
              attachmentRequest: {
                serverId: args.server_id,
                target,
                targetId,
                reason: args.reason,
              },
            },
          });
        } catch (err) {
          return toModelToolErrorOutput(err);
        }
      },
    }),
  };
}
