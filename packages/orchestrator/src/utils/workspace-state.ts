import type { ApiRepository } from '../services/repository-reader.js';
import { recallMemoryEntries } from './memory.js';

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
const MAX_CHANNEL_COMMITMENTS = 6;
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

  // --- Open commitments (this agent, ACROSS the whole workspace) ---
  // Post-review fix: the previous implementation only queried the
  // *current channel* via `listTodosForChannel(channelId)`, so an
  // agent juggling multiple channels lost sight of commitments owed
  // in any other one. We now use the dedicated cross-channel query.
  // The block runs even when `channelId` is absent (DM threads,
  // self-channel wakes) so the agent always sees what they owe.
  const listOpenForMember = input.repo.listOpenCommitmentsForMember;
  const memberOpen = listOpenForMember
    ? (() => {
        try {
          return listOpenForMember(input.organizationId, input.memberId, {
            limit: MAX_OPEN_COMMITMENTS,
          });
        } catch {
          return [];
        }
      })()
    : [];
  if (memberOpen.length > 0) {
    const now = Date.now();
    const lines = memberOpen
      .filter((row) => row.deliverableSummary)
      .slice(0, MAX_OPEN_COMMITMENTS)
      .map((row) => {
        const lastTouch = row.lastProgressAt ?? row.createdAt;
        const ageMin = Math.max(0, Math.round((now - new Date(lastTouch).getTime()) / 60_000));
        const title = (row.deliverableSummary ?? row.title).slice(0, 160);
        const empties = (row.emptyWakeCount ?? 0) > 0 ? ` empties="${row.emptyWakeCount}"` : '';
        // Surface the owning channel so an agent in #design can
        // see they owe something in #engineering — and act on it,
        // or call channel.handoff to redirect.
        const channelAttr = row.channelId
          ? ` channel="${escapeXml(row.channelId)}"`
          : '';
        return `  <commitment age_min="${ageMin}"${empties}${channelAttr}>${escapeXml(title)}</commitment>`;
      });
    if (lines.length > 0) {
      sections.push(`<open-commitments>\n${lines.join('\n')}\n</open-commitments>`);
    }
  }

  // --- Channel-wide commitments (Bet 4 from Hermes review) ----------
  // Surfaces commitments owned by ANY agent in this channel, not just
  // the current member. Closes the "private memory per agent" gap —
  // agent B can now see agent A is in the middle of delivering Y.
  if (input.channelId && input.repo.listTodosForChannel) {
    try {
      const allOpen = input.repo.listTodosForChannel(input.organizationId, input.channelId, {
        status: 'in_progress',
      });
      const others = allOpen
        .filter((row) => row.memberId !== input.memberId && row.deliverableSummary)
        .slice(0, MAX_CHANNEL_COMMITMENTS);
      if (others.length > 0) {
        const lines = others.map((row) => {
          const owner = input.repo.getMember(input.organizationId, row.memberId);
          const ownerName = owner?.name ?? row.memberId;
          return `  <commitment by="${escapeXml(ownerName)}">${escapeXml((row.deliverableSummary ?? row.title).slice(0, 160))}</commitment>`;
        });
        sections.push(`<channel-commitments>\n${lines.join('\n')}\n</channel-commitments>`);
      }
    } catch {
      // best-effort
    }
  }

  // --- Recent artifacts (write/edit tool calls in the lookback) -----
  // Surfaces file paths the agent (or anyone on the team) wrote in
  // the last ARTIFACT_LOOKBACK_HOURS so wakes don't have to
  // re-derive what was just produced. Scoped to the current channel
  // when available; falls back to org-wide when this is a non-
  // channel run.
  if (input.repo.listRecentWorkspaceArtifacts) {
    try {
      const sinceIso = new Date(
        Date.now() - ARTIFACT_LOOKBACK_HOURS * 60 * 60 * 1000,
      ).toISOString();
      const recent = input.repo.listRecentWorkspaceArtifacts({
        organizationId: input.organizationId,
        channelId: input.channelId,
        sinceIso,
        limit: MAX_RECENT_ARTIFACTS,
      });
      if (recent.length > 0) {
        const lines = recent.map((row) => {
          const ageMin = Math.max(
            0,
            Math.round((Date.now() - new Date(row.updatedAt).getTime()) / 60_000),
          );
          const owner = input.repo.getMember?.(input.organizationId, row.writtenBy);
          const writerName = owner?.name ?? row.writtenBy;
          return `  <artifact age_min="${ageMin}" by="${escapeXml(writerName)}" bytes="${row.sizeBytes}">${escapeXml(row.path)}</artifact>`;
        });
        sections.push(`<recent-artifacts>\n${lines.join('\n')}\n</recent-artifacts>`);
      }
    } catch {
      // best-effort
    }
  }

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
  try {
    const entries = recallMemoryEntries(input.repo, {
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
