import { normalizeProviderKey } from '@ujima/framework';
import { selectLanguageModel } from '@ujima/llm';
import { safeFallbackModelForProvider, type ReasoningEffort } from '@ujima/shared';
import type { LanguageModel } from 'ai';
import type { ProviderKind } from '@ujima/llm';
import type { ModelNotFoundError } from '../services/agent-loop.js';

export function logModelNotFoundFallback(logLabel: string, error: ModelNotFoundError, memberLabel: string, fallbackId?: string): void {
  const target = fallbackId ? `"${fallbackId}"` : 'safeFallbackModelForProvider';
  console.warn(
    `[${logLabel}] model "${error.modelId}" rejected by provider; ` +
      `falling back to ${target} for member="${memberLabel}"`,
  );
}

export function createProviderSafeFallbackHandler(input: {
  logLabel: string;
  memberLabel: string;
  providerKind: string;
  providerName: string;
  getApiKey: (providerName: string) => string | null;
  baseUrl?: string;
  reasoningEffort?: ReasoningEffort;
}): (error: ModelNotFoundError) => LanguageModel | null {
  return (error) => {
    const kind = input.providerKind || error.providerKindHint || '';
    const fallbackId = safeFallbackModelForProvider(kind);
    const apiKey = input.getApiKey(input.providerName);
    if (!fallbackId || !apiKey || !kind) return null;
    logModelNotFoundFallback(input.logLabel, error, input.memberLabel, fallbackId);
    return selectLanguageModel({
      kind: kind as ProviderKind,
      modelId: fallbackId,
      apiKey,
      baseUrl: input.baseUrl,
      reasoningEffort: input.reasoningEffort,
    });
  };
}

export function createSpiritModelNotFoundHandler(input: {
  logLabel: string;
  memberLabel: string;
  resolve: (error: ModelNotFoundError) => Promise<LanguageModel | null> | LanguageModel | null;
}): (error: ModelNotFoundError) => Promise<LanguageModel | null> {
  return async (error) => {
    logModelNotFoundFallback(input.logLabel, error, input.memberLabel);
    return await Promise.resolve(input.resolve(error));
  };
}

export function resolveProviderKind(
  provider: { kind?: string } | null | undefined,
  error: ModelNotFoundError,
): string {
  return provider?.kind ?? error.providerKindHint ?? '';
}

export function resolveProviderNameFromMember(
  memberLlm: string | undefined,
  roleProvider: string | undefined,
): string {
  return normalizeProviderKey(memberLlm ?? roleProvider ?? '');
}
