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

export function resolveReasoningProviderForModel(provider: string, modelId?: string): string {
  const normalizedProvider = normalizeProviderToken(provider);
  if (normalizedProvider === 'openrouter' && modelId) {
    const family = normalizeProviderToken(modelId.split('/', 1)[0] ?? '');
    if (PROVIDER_REASONING_EFFORTS[family]) return family;
  }
  return normalizedProvider;
}

export function getReasoningEffortsForProvider(
  provider: string,
  modelId?: string,
): readonly ReasoningEffort[] {
  return PROVIDER_REASONING_EFFORTS[resolveReasoningProviderForModel(provider, modelId)] ?? ['none'];
}

export function clampReasoningEffortForProvider(
  provider: string,
  effort?: ReasoningEffort,
  modelId?: string,
): ReasoningEffort {
  const options = getReasoningEffortsForProvider(provider, modelId);
  if (!effort) return options[0] ?? 'none';
  if (options.includes(effort)) return effort;
  return options[options.length - 1] ?? 'none';
}
