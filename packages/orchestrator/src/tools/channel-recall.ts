import { z } from 'zod';
import type { OrchestratorTool } from './types.js';

/**
 * Bet 4 — cross-channel recall. The agent in channel A needs to find
 * out what was said about a topic in channel B without the operator
 * spelling out the channel name. Today's only mechanism is to call
 * `channel.read` against a specific channel with a `query`; this tool
 * extends the surface to "search across all channels I can see, plus
 * artifacts I (or my team) have written to disk."
 *
 * Backed by FTS5 over `messages_fts` (per-channel keyword search,
 * already shipped) and `workspace_files_fts` (Bet 4's new index over
 * the `ai/memory-bank/**` tree). BM25-ranked. No embeddings — the
 * council's empirical bet is that lexical recall covers >75% of the
 * "what did we decide about X" cases on the corpus sizes we expect
 * (≤500k messages per workspace).
 *
 * Scope: messages are scoped to the channels the caller has
 * visibility into (delegated to `searchChannelMessages` in the
 * conversation repo, which already filters by membership). Artifacts
 * are scoped to the org — workspace files are not per-channel ACL'd.
 */
const ChannelRecallSchema = z.object({
  query: z.string().min(2).max(200),
  /**
   * One of: 'channel' (this thread / channel only), 'org' (all
   * messages I can see across channels), 'files' (workspace artifacts),
   * 'all' (default — union of org messages + files).
   */
  scope: z.enum(['channel', 'org', 'files', 'all']).default('all'),
  /** Override the searched channel (defaults to current thread's channel). */
  channel_id: z.string().min(1).optional(),
  /** ISO timestamp lower bound — only hits at or after `since`. */
  since: z.string().optional(),
  limit: z.number().int().min(1).max(20).default(5),
});

export interface ChannelRecallHit {
  source: 'message' | 'file';
  snippet: string;
  /** Stable identifier — message_id for messages, path for files. */
  ref: string;
  channelId?: string;
  channelName?: string;
  authorId: string;
  createdAt: string;
}

export const channelRecallTool: OrchestratorTool<typeof ChannelRecallSchema> = {
  id: 'channel.recall',
  schema: ChannelRecallSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'message',
    permissionMcpId: 'channels',
    input: args,
  }),
  execute: async ({ invocation, repo, conversations }) => {
    const input = invocation.input as z.infer<typeof ChannelRecallSchema>;
    const limit = typeof input.limit === 'number' ? input.limit : 5;
    const scope = (input.scope as 'channel' | 'org' | 'files' | 'all') ?? 'all';
    const query = String(input.query);
    const since = typeof input.since === 'string' ? input.since : undefined;
    const hits: ChannelRecallHit[] = [];

    // --- Message hits -------------------------------------------------
    if (scope === 'channel' || scope === 'org' || scope === 'all') {
      try {
        // Resolve the channel id for 'channel' scope:
        //   1. Explicit `channel_id` argument always wins.
        //   2. Otherwise fall back to the current thread's channel
        //      via the threads repo — this is what callers expect
        //      when they pass `scope: 'channel'` without an id.
        // Without this resolution the tool used to silently widen
        // to the org-scope fan-out branch, returning hits from
        // every visible channel.
        let visibleChannelId =
          typeof input.channel_id === 'string' ? input.channel_id : undefined;
        if (scope === 'channel' && !visibleChannelId && invocation.threadId) {
          const thread = repo.getThread(invocation.organizationId, invocation.threadId);
          visibleChannelId = thread?.channelId;
        }
        if (scope === 'channel' && visibleChannelId) {
          const page = await conversations.readChannel({
            organizationId: invocation.organizationId,
            memberId: invocation.memberId,
            channelId: visibleChannelId,
            query,
            since,
            limit,
          });
          for (const m of page.data.slice(0, limit)) {
            hits.push({
              source: 'message',
              snippet: m.content.slice(0, 240),
              ref: m.id,
              channelId: m.channelId,
              authorId: m.senderId,
              createdAt: m.createdAt,
            });
          }
        } else if (scope === 'channel') {
          // `scope: 'channel'` was requested but we couldn't
          // resolve a channel id from either the argument or the
          // current thread. Refuse to silently widen to org scope
          // — the caller asked for one channel and getting many
          // would bury the hit they want. Return an empty
          // message-hit set; file hits below still run.
        } else {
          // Org-scope: fan out across the channels the member can
          // see. Bound the per-channel limit so a single noisy
          // channel doesn't drown the result set.
          const visibleChannels = conversations.listVisibleChannels({
            organizationId: invocation.organizationId,
            memberId: invocation.memberId,
            scope: 'mine',
          });
          const perChannelLimit = Math.max(
            2,
            Math.ceil(limit / Math.max(1, visibleChannels.length)),
          );
          for (const channel of visibleChannels) {
            try {
              const page = await conversations.readChannel({
                organizationId: invocation.organizationId,
                memberId: invocation.memberId,
                channelId: channel.id,
                query,
                since,
                limit: perChannelLimit,
              });
              for (const m of page.data.slice(0, perChannelLimit)) {
                hits.push({
                  source: 'message',
                  snippet: m.content.slice(0, 240),
                  ref: m.id,
                  channelId: m.channelId,
                  channelName: channel.name,
                  authorId: m.senderId,
                  createdAt: m.createdAt,
                });
              }
            } catch {
              // Per-channel errors don't abort the org-scope fan-out.
            }
            if (hits.length >= limit * 2) break;
          }
        }
      } catch {
        // FTS errors degrade gracefully — caller still gets file hits.
      }
    }

    // --- File hits ---------------------------------------------------
    if ((scope === 'files' || scope === 'all') && repo.searchWorkspaceFiles) {
      try {
        const fileHits = repo.searchWorkspaceFiles({
          organizationId: invocation.organizationId,
          query,
          limit,
          sinceIso: since,
        });
        for (const f of fileHits) {
          hits.push({
            source: 'file',
            snippet: f.snippet,
            ref: f.path,
            channelId: f.channelId,
            authorId: f.writtenBy,
            createdAt: f.updatedAt,
          });
        }
      } catch {
        // best-effort
      }
    }

    // Rank by recency within the merged set; cap to `limit`.
    hits.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { query, scope, hits: hits.slice(0, limit) };
  },
};
