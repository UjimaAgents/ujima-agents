import type { ReasoningEffort } from './org-schemas.js';

const PROVIDER_REASONING_EFFORTS: Record<string, readonly ReasoningEffort[]> = {
  anthropic: ['none', 'low', 'medium', 'high', 'extra_high'],
  openai: ['none', 'low', 'medium', 'high', 'extra_high'],
  'openai-codex': ['none', 'low', 'medium', 'high', 'extra_high'],
  google: ['none', 'low', 'medium', 'high'],
};

function normalizeProviderToken(value: string) {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

export function getReasoningEffortsForProvider(provider: string): readonly ReasoningEffort[] {
  return PROVIDER_REASONING_EFFORTS[normalizeProviderToken(provider)] ?? ['none'];
}

export function clampReasoningEffortForProvider(
  provider: string,
  effort?: ReasoningEffort,
): ReasoningEffort {
  const options = getReasoningEffortsForProvider(provider);
  if (!effort) return options[0] ?? 'none';
  if (options.includes(effort)) return effort;
  return options[options.length - 1] ?? 'none';
}
