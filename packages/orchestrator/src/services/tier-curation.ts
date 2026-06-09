import { randomUUID } from 'node:crypto';
import type { AuditEvent, Member } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

// Bidirectional tier curation (mcp_connector_dispatch_plan.md §9.4).
//
// The analyzer reads §12 connector_invocation_* audit rows from PR 8,
// scores each (member, server) attachment, and writes demote/promote
// suggestions into tier_curation_suggestions (migration 050). It does
// NOT auto-apply — operators see the panel and flip tiers themselves
// via PR 6's settings UI. The orthogonality invariant from §17.5 stays
// intact: tier mutation is always a human decision, never code-driven.
//
// The §9.4 rules:
//
//   demote (native → dispatch): native-tier attachment with zero
//     completed invocations across the lookback window. Native
//     attachments cost system-prompt budget; an unused one is pure
//     overhead and is the easy demotion candidate.
//
//   promote (dispatch → native): dispatch-tier attachment where
//     (volume_per_run > V) AND (validation_error_rate > E). The
//     error-rate gate matters: volume alone over-promotes hot read
//     tools that don't actually need typed schemas. The error signal
//     is "the model is fumbling the indirection of
//     invoke_connector_tool" — fixable by giving it the typed slot.
//
// Reads of audit data are filter-in-memory: we list the org's audit
// events (already indexed by org+createdAt) and partition by
// (memberId, serverId) in code. For org-sized data this stays cheap;
// if a future scale point pushes it, the next step is an indexed
// COUNT query in repositories/audit.ts, not a job-runner rewrite.

export interface TierCurationDeps {
  repo: Pick<
    ApiRepository,
    | 'saveTierCurationSuggestion'
    | 'listTierCurationSuggestions'
    | 'listAuditEvents'
    | 'listAgentMcpAttachments'
    | 'listMembers'
    | 'listRuns'
  >;
  generateId?: () => string;
  now?: () => string;
}

export interface TierCurationAnalyzeInput {
  organizationId: string;
  /**
   * Number of recent runs to score against. Default 30. The window is
   * "last N runs" not "last N days" because invocation density varies
   * hugely across orgs — counting runs normalises the signal across
   * a quiet workspace and a busy one.
   */
  windowRuns?: number;
  /**
   * Promotion floor: invocations per run above which a dispatch tool
   * is a volume candidate. Default 5. Tuned for "tool called multiple
   * times per task" rather than "occasional use".
   */
  volumePerRunThreshold?: number;
  /**
   * Promotion floor: error-rate above which a dispatch tool is a
   * model-fumbling candidate. Default 0.10 (10%). Errors are the
   * `status='error'` audit rows; policy denials (status='blocked')
   * are excluded so an operator's rejection doesn't masquerade as a
   * promote signal.
   */
  errorRateThreshold?: number;
}

export interface TierCurationAnalyzeResult {
  suggestionsWritten: number;
  /** Per-direction breakdown for the eventual admin/observability view. */
  demoteCount: number;
  promoteCount: number;
  /** Number of runs the analyzer scored against. */
  runsConsidered: number;
}

export interface TierCurationService {
  analyzeOrganization(input: TierCurationAnalyzeInput): Promise<TierCurationAnalyzeResult>;
}

interface AttachmentStats {
  completions: number;
  errors: number;
}

const DEFAULT_WINDOW_RUNS = 30;
const DEFAULT_VOLUME_PER_RUN = 5;
const DEFAULT_ERROR_RATE = 0.1;

/** Internal map key — keep server-only for now (per-tool drill-down belongs in PR 10+). */
function statsKey(memberId: string, serverId: string): string {
  return `${memberId} ${serverId}`;
}

export function createTierCurationService(
  deps: TierCurationDeps,
): TierCurationService {
  const newId = deps.generateId ?? (() => `tcs_${randomUUID()}`);
  const newNow = deps.now ?? (() => new Date().toISOString());

  return {
    async analyzeOrganization(input) {
      const windowRuns = input.windowRuns ?? DEFAULT_WINDOW_RUNS;
      const volumeThreshold = input.volumePerRunThreshold ?? DEFAULT_VOLUME_PER_RUN;
      const errorRateThreshold = input.errorRateThreshold ?? DEFAULT_ERROR_RATE;

      // 1. Resolve the lookback window to a concrete set of runIds. We
      //    page the first windowRuns descending — `listRuns` returns
      //    most-recent-first per repository contract.
      const recentRuns = deps.repo
        .listRuns(input.organizationId, undefined, windowRuns)
        .data.slice(0, windowRuns);
      const runIdSet = new Set(recentRuns.map((run) => run.id));
      const runsConsidered = recentRuns.length;
      if (runsConsidered === 0) {
        return { suggestionsWritten: 0, demoteCount: 0, promoteCount: 0, runsConsidered: 0 };
      }

      // 2. Pull the org-wide audit log once and partition by
      //    (memberId, serverId). Filter to the §12 connector events
      //    that landed in the window. `actorId` carries the member id
      //    per PR 8's emitter contract.
      const stats = new Map<string, AttachmentStats>();
      for (const event of deps.repo.listAuditEvents(input.organizationId)) {
        if (!isConnectorCompletion(event)) continue;
        const runId = readRunId(event);
        if (!runId || !runIdSet.has(runId)) continue;
        if (!event.actorId || !event.serverId) continue;
        const key = statsKey(event.actorId, event.serverId);
        const entry = stats.get(key) ?? { completions: 0, errors: 0 };
        entry.completions += 1;
        if (event.status === 'error') entry.errors += 1;
        stats.set(key, entry);
      }

      // 3. Walk each agent's attachments and decide direction. We DO
      //    NOT iterate the audit map directly — an attachment that was
      //    just created (no audit history) is still a candidate for
      //    demote if it's wasting the native-palette budget without
      //    being used.
      const suggestions: {
        memberId: string;
        mcpServerId: string;
        direction: 'demote' | 'promote';
        rationale: string;
        signalMetadata: Record<string, unknown>;
      }[] = [];

      for (const member of deps.repo.listMembers(input.organizationId)) {
        if (!isAgent(member)) continue;
        const attachments = deps.repo.listAgentMcpAttachments(
          input.organizationId,
          member.id,
        );
        for (const attachment of attachments) {
          const key = statsKey(member.id, attachment.mcpServerId);
          const observed = stats.get(key) ?? { completions: 0, errors: 0 };

          if (attachment.tier === 'native' && observed.completions === 0) {
            suggestions.push({
              memberId: member.id,
              mcpServerId: attachment.mcpServerId,
              direction: 'demote',
              rationale:
                `Zero completed invocations across the last ${runsConsidered} run(s); the native ` +
                'palette budget is being spent on a tool this agent never calls.',
              signalMetadata: {
                runsConsidered,
                completions: 0,
                tierAtScoreTime: 'native',
              },
            });
            continue;
          }

          if (attachment.tier === 'dispatch' && observed.completions > 0) {
            const volumePerRun = observed.completions / runsConsidered;
            const errorRate = observed.errors / observed.completions;
            if (volumePerRun > volumeThreshold && errorRate > errorRateThreshold) {
              suggestions.push({
                memberId: member.id,
                mcpServerId: attachment.mcpServerId,
                direction: 'promote',
                rationale:
                  `High dispatch volume (${volumePerRun.toFixed(2)}/run) with high error rate ` +
                  `(${(errorRate * 100).toFixed(1)}%) across ${runsConsidered} run(s). The model ` +
                  'is fumbling the meta-tool indirection; promoting to native gives it the typed ' +
                  'schema and is expected to drop the validation error rate.',
                signalMetadata: {
                  runsConsidered,
                  completions: observed.completions,
                  errors: observed.errors,
                  volumePerRun,
                  errorRate,
                  tierAtScoreTime: 'dispatch',
                },
              });
            }
          }
        }
      }

      // 4. Persist. The PR 8 repo writer is UPSERT-on-(org, member,
      //    server, direction, status); a repeat run from the cron does
      //    NOT stack duplicate pending suggestions and preserves the
      //    original `created_at` so the UI can render "first surfaced
      //    N days ago" later.
      const createdAt = newNow();
      let demoteCount = 0;
      let promoteCount = 0;
      for (const s of suggestions) {
        deps.repo.saveTierCurationSuggestion({
          id: newId(),
          organizationId: input.organizationId,
          memberId: s.memberId,
          mcpServerId: s.mcpServerId,
          direction: s.direction,
          rationale: s.rationale,
          signalMetadata: s.signalMetadata,
          status: 'pending',
          createdAt,
        });
        if (s.direction === 'demote') demoteCount += 1;
        else promoteCount += 1;
      }

      return {
        suggestionsWritten: suggestions.length,
        demoteCount,
        promoteCount,
        runsConsidered,
      };
    },
  };
}

function isAgent(member: Member): boolean {
  return member.kind === 'agent' && !member.retiredAt;
}

function isConnectorCompletion(event: AuditEvent): boolean {
  return event.action === 'connector_invocation_completed';
}

function readRunId(event: AuditEvent): string | undefined {
  const runId = event.metadata?.runId;
  return typeof runId === 'string' ? runId : undefined;
}
