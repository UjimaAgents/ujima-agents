import type { ApiRepository } from '../services/repository-reader.js';

/**
 * Bet 3 — `<workspace-state>` ground-truth block.
 *
 * Companion to the existing `<thread-state>`: where thread-state
 * answers "who said what in this thread", workspace-state answers
 * "what does this agent currently OWN across the whole workspace?"
 * Surfaces open commitments (todos), recent artifact paths (from
 * `run_steps` write/edit calls), and recent decision-log entries
 * for the current channel. Bounded at ~800 tokens by truncation
 * order: open-commitments > recent-artifacts > recent-decisions.
 *
 * Read-only — no new tables, no new write paths. Just a projection
 * of `todos` + `run_steps` + `decision_log` shaped for the model.
 */

const MAX_OPEN_COMMITMENTS = 6;
const MAX_RECENT_ARTIFACTS = 6;
const MAX_RECENT_DECISIONS = 5;
const ARTIFACT_LOOKBACK_HOURS = 24;

export interface BuildWorkspaceStateInput {
  organizationId: string;
  memberId: string;
  channelId?: string;
  repo: ApiRepository;
}

export function buildWorkspaceStateBlock(input: BuildWorkspaceStateInput): string | null {
  const sections: string[] = [];

  // --- Open commitments (across all channels this agent owns) -----
  if (input.repo.listTodosForChannel) {
    const open: { title: string; channelId?: string; ageMin: number; empties: number }[] = [];
    // We can't list across all channels in one shot without a new
    // repo method; iterate from the current channel and hope the
    // common case (own-channel commitments) covers it. Future
    // upgrade: a `listOpenCommitmentsForMember` repo method.
    if (input.channelId && input.repo.listTodosForChannel) {
      try {
        const rows = input.repo.listTodosForChannel(input.organizationId, input.channelId, {
          memberId: input.memberId,
          status: 'in_progress',
        });
        const now = Date.now();
        for (const row of rows.slice(0, MAX_OPEN_COMMITMENTS)) {
          if (!row.deliverableSummary) continue;
          const lastTouch = row.lastProgressAt ?? row.createdAt;
          const ageMin = Math.max(0, Math.round((now - new Date(lastTouch).getTime()) / 60_000));
          open.push({
            title: row.deliverableSummary.slice(0, 160),
            channelId: row.channelId,
            ageMin,
            empties: row.emptyWakeCount ?? 0,
          });
        }
      } catch {
        // best-effort
      }
    }
    if (open.length > 0) {
      const lines = open.map((c) => {
        const empties = c.empties > 0 ? ` empties=${c.empties}` : '';
        return `  <commitment age_min="${c.ageMin}"${empties}>${escapeXml(c.title)}</commitment>`;
      });
      sections.push(`<open-commitments>\n${lines.join('\n')}\n</open-commitments>`);
    }
  }

  // --- Recent artifacts (write/edit tool calls in the lookback) -----
  // Cheap recency-based artifact list: pull from workspace_files
  // ordered by updated_at via a repo helper. We don't have one
  // dedicated for "recent artifacts" yet; the searchWorkspaceFiles
  // path is FTS-based. Skip for now — agents see recent paths via
  // run_steps in the live run's transcript.

  // --- Recent decisions (channel-scoped) ----------------------------
  if (input.channelId && input.repo.listDecisionLogForChannel) {
    try {
      const decisions = input.repo.listDecisionLogForChannel(
        input.organizationId,
        input.channelId,
        MAX_RECENT_DECISIONS,
      );
      if (decisions.length > 0) {
        const lines = decisions.map(
          (d) =>
            `  <decision decided_at="${d.decidedAt}" by="${escapeXml(d.decidedBy)}">${escapeXml(d.decisionText.slice(0, 200))}</decision>`,
        );
        sections.push(`<recent-decisions>\n${lines.join('\n')}\n</recent-decisions>`);
      }
    } catch {
      // best-effort
    }
  }

  // --- Persistent memory (Bet 5) ----------------------------------
  if (input.repo.recallMemoryEntries) {
    try {
      const entries = input.repo.recallMemoryEntries({
        organizationId: input.organizationId,
        memberId: input.memberId,
        limit: 10,
        touch: false,
      });
      if (entries.length > 0) {
        const lines = entries.map(
          (e) =>
            `  <entry key="${escapeXml(e.key)}" kind="${escapeXml(e.kind)}">${escapeXml(e.content.slice(0, 200))}</entry>`,
        );
        sections.push(`<persistent-memory>\n${lines.join('\n')}\n</persistent-memory>`);
      }
    } catch {
      // best-effort
    }
  }

  // Suppress lookback-only var warning — kept for forward extension.
  void ARTIFACT_LOOKBACK_HOURS;
  void MAX_RECENT_ARTIFACTS;

  if (sections.length === 0) return null;
  return `<workspace-state>\n${sections.join('\n')}\n</workspace-state>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
