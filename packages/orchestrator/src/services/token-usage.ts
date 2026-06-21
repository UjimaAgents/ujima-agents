import type { Message } from '@ujima/shared';
import type { NormalizedTokenUsage } from '@ujima/agent-core';

export type { NormalizedTokenUsage } from '@ujima/agent-core';
export { normalizeTokenUsage, normalizeStepTokenUsage } from '@ujima/agent-core';

export function hasTokenUsage(usage: NormalizedTokenUsage): boolean {
  return usage.inputTokens > 0 || usage.outputTokens > 0;
}

/**
 * Silently stamp final token counts onto a persisted message
 * without re-broadcasting via realtime. The live counter under the
 * typing indicator owns the in-flight visualization; this footer
 * only matters after reload.
 */
export function persistMessageTokens(
  repo: { updateMessage(message: Message): Message },
  message: Message,
  usage: NormalizedTokenUsage,
): void {
  if (!hasTokenUsage(usage)) return;
  repo.updateMessage({
    ...message,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    editedAt: new Date().toISOString(),
  });
}
