import type { Message } from '@ujima/shared';

export interface NormalizedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export function normalizeTokenUsage(usage: unknown): NormalizedTokenUsage {
  const value = usage as { inputTokens?: unknown; outputTokens?: unknown; totalTokens?: unknown } | undefined;
  const inputTokens = tokenTotal(value?.inputTokens);
  const outputTokens = tokenTotal(value?.outputTokens);
  const totalTokens = tokenTotal(value?.totalTokens) || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

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

function tokenTotal(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (value && typeof value === 'object') {
    return tokenTotal((value as { total?: unknown }).total);
  }
  return 0;
}
