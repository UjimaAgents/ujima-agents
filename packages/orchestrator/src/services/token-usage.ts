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

export function accumulateStepUsage(
  steps: readonly { usage?: unknown }[],
): NormalizedTokenUsage {
  return steps.reduce<NormalizedTokenUsage>(
    (acc, step) => {
      const u = normalizeTokenUsage(step.usage);
      return {
        inputTokens: acc.inputTokens + u.inputTokens,
        outputTokens: acc.outputTokens + u.outputTokens,
        totalTokens: acc.totalTokens + u.totalTokens,
      };
    },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );
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
