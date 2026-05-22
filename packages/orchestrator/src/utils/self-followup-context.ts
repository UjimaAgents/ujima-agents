import type { ApiRepository } from '../services/repository-reader.js';

/**
 * Bet 2 — `<self-followup-context>` injection.
 *
 * When the scheduler fires a self-followup wake, the model sees the
 * last 20 messages in the thread — which may be hours old and not
 * mention the commitment that triggered the wake. The agent then
 * wakes blind to its own promise and produces no useful output
 * (the Layla stall). This block re-attaches:
 *
 *   - The original commitment message (full body, not 200-char preview)
 *   - The deliverable summary
 *   - The empty-wake count (so the model knows it has been here before)
 *   - Artifact paths from this agent's run_steps since the commitment
 *
 * Anchored on the `todos` row, not a salience scalar — the
 * commitment itself is structurally the most relevant context.
 *
 * Returns null when this wake is not self-followup or when no
 * matching commitment row exists (degraded gracefully — the rest
 * of the prompt is unchanged).
 */

export interface BuildSelfFollowupContextInput {
  organizationId: string;
  memberId: string;
  runId: string;
  sourceMessageId?: string;
  wakeReason?: string | null;
  repo: ApiRepository;
}

export function buildSelfFollowupContextBlock(
  input: BuildSelfFollowupContextInput,
): string | null {
  if (input.wakeReason !== 'self-followup') return null;
  if (!input.sourceMessageId) return null;
  if (!input.repo.findCommitmentBySourceMessage) return null;

  const todo = input.repo.findCommitmentBySourceMessage(
    input.organizationId,
    input.sourceMessageId,
  );
  if (!todo) return null;

  const lines: string[] = ['<self-followup-context>'];

  const original = todo.sourceMessageId
    ? input.repo.getMessage(input.organizationId, todo.sourceMessageId)
    : null;
  if (original?.content) {
    const body = original.content.length > 1000 ? `${original.content.slice(0, 1000)}…` : original.content;
    lines.push(`  <original-commitment posted_at="${original.createdAt}">`);
    lines.push(`    ${escapeXml(body)}`);
    lines.push('  </original-commitment>');
  } else if (todo.deliverableSummary) {
    lines.push(`  <deliverable>${escapeXml(todo.deliverableSummary)}</deliverable>`);
  }

  if (todo.deliverableSummary && original?.content) {
    lines.push(`  <deliverable>${escapeXml(todo.deliverableSummary.slice(0, 200))}</deliverable>`);
  }

  if (todo.emptyWakeCount && todo.emptyWakeCount > 0) {
    lines.push(`  <empty-wake-count>${todo.emptyWakeCount}</empty-wake-count>`);
    lines.push(
      `  <note>You have woken on this commitment ${todo.emptyWakeCount} time(s) already without publishing concrete progress. This wake counts; either publish or pass with a real blocker.</note>`,
    );
  }

  if (todo.dueAt) {
    lines.push(`  <due-at>${todo.dueAt}</due-at>`);
  }

  // Pull recent run steps from this agent on the same channel since
  // the commitment was created. The steps already include write/edit
  // resource paths — they're the agent's published artifacts.
  if (input.repo.listRunSteps) {
    try {
      const steps = input.repo.listRunSteps(input.organizationId, input.runId);
      const artifactPaths = new Set<string>();
      for (const step of steps) {
        if (step.action === 'write' && step.resourcePath) {
          artifactPaths.add(step.resourcePath);
        }
      }
      if (artifactPaths.size > 0) {
        lines.push('  <artifacts-touched-this-run>');
        for (const path of Array.from(artifactPaths).slice(0, 8)) {
          lines.push(`    <path>${escapeXml(path)}</path>`);
        }
        lines.push('  </artifacts-touched-this-run>');
      }
    } catch {
      // best-effort
    }
  }

  lines.push('</self-followup-context>');
  return lines.join('\n');
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
