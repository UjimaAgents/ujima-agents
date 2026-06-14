import type { ApiRepository } from '../services/repository-reader.js';
import { recallMemoryEntries } from './memory.js';

/**
 * Bet 3 — `<workspace-state>` ground-truth block.
 *
 * Companion to the existing `<thread-state>`: where thread-state
 * answers "who said what in this thread", workspace-state answers
 * "what does this agent currently OWN across the whole workspace?"
 * Surfaces recent artifact paths (from `run_steps` write/edit calls),
 * recent decision-log entries, and memory for the current channel.
 *
 * Read-only — no new tables, no new write paths. Just a projection
 * of `run_steps` + `decision_log` shaped for the model.
 */

const MAX_RECENT_ARTIFACTS = 6;
const MAX_RECENT_DECISIONS = 5;
const ARTIFACT_LOOKBACK_HOURS = 24;

export interface BuildWorkspaceStateInput {
  organizationId: string;
  memberId: string;
  channelId?: string;
  threadId?: string;
  repo: ApiRepository;
}

export function buildWorkspaceStateBlock(input: BuildWorkspaceStateInput): string | null {
  const sections: string[] = [];

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
      limit: 20,
      touch: false,
    });
    const relevant = entries
      .sort((left, right) => {
        const leftLinked = memoryMatchesContext(left.metadata, input) ? 1 : 0;
        const rightLinked = memoryMatchesContext(right.metadata, input) ? 1 : 0;
        if (leftLinked !== rightLinked) return rightLinked - leftLinked;
        return Date.parse(right.lastRecalledAt ?? right.createdAt) -
          Date.parse(left.lastRecalledAt ?? left.createdAt);
      })
      .slice(0, 10);
    if (relevant.length > 0) {
      const lines = relevant.map(
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

function memoryMatchesContext(
  metadata: Record<string, unknown>,
  input: Pick<BuildWorkspaceStateInput, 'channelId' | 'threadId'>,
): boolean {
  return (
    (Boolean(input.threadId) && metadata.threadId === input.threadId) ||
    (Boolean(input.channelId) && metadata.channelId === input.channelId)
  );
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
