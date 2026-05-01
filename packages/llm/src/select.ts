import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { LLMError, PROVIDER_KINDS, type ProviderKind } from './types.js';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface SelectLanguageModelInput {
  /** Provider kind. See {@link ProviderKind}. */
  kind: ProviderKind;
  /** Model id (e.g. `claude-opus-4-7`, `gpt-4o-mini`, `anthropic/claude-opus-4-7`). */
  modelId: string;
  /** API key. Required for all kinds except `ollama` (which only uses `baseUrl`). */
  apiKey?: string;
  /** Custom base URL. For `openrouter` defaults to the public router; for `ollama` defaults to `http://127.0.0.1:11434/v1`. */
  baseUrl?: string;
}

/**
 * Resolve a provider kind + model id to an AI SDK {@link LanguageModel}.
 *
 * This is the single canonical entrypoint for LLM selection. Every code path
 * that runs an agent turn — the `/api/runs` AiService, the legacy task runner
 * under `engine='ai-sdk'`, the conflict referee, the task promoter — goes
 * through here.
 *
 * Adding a new provider is one branch + one `PROVIDER_KINDS` entry; if the
 * provider is OpenAI-compatible it's a base-URL-only change with zero new
 * dependencies.
 */
export function selectLanguageModel(input: SelectLanguageModelInput): LanguageModel {
  if (!PROVIDER_KINDS.includes(input.kind)) {
    throw new LLMError('unsupported_kind', `Unsupported provider kind "${input.kind}"`);
  }

  if (input.kind === 'anthropic') {
    if (!input.apiKey) throw new LLMError('not_configured', 'anthropic provider requires apiKey');
    return createAnthropic({ apiKey: input.apiKey }).messages(input.modelId);
  }

  if (input.kind === 'openai') {
    if (!input.apiKey) throw new LLMError('not_configured', 'openai provider requires apiKey');
    return createOpenAI({ apiKey: input.apiKey }).responses(input.modelId);
  }

  if (input.kind === 'google') {
    if (!input.apiKey) throw new LLMError('not_configured', 'google provider requires apiKey');
    return createGoogleGenerativeAI({ apiKey: input.apiKey }).languageModel(input.modelId);
  }

  if (input.kind === 'openrouter') {
    if (!input.apiKey) throw new LLMError('not_configured', 'openrouter provider requires apiKey');
    return createOpenAI({
      apiKey: input.apiKey,
      baseURL: input.baseUrl ?? OPENROUTER_BASE_URL,
    }).chat(input.modelId);
  }

  if (input.kind === 'ollama') {
    // Ollama exposes an OpenAI-compatible endpoint at /v1; key is irrelevant
    // but the SDK requires a non-empty string.
    return createOpenAI({
      apiKey: input.apiKey ?? 'ollama',
      baseURL: input.baseUrl ?? DEFAULT_OLLAMA_BASE_URL,
    }).chat(input.modelId);
  }

  if (input.kind === 'deepseek') {
    if (!input.apiKey) throw new LLMError('not_configured', 'deepseek provider requires apiKey');
    return createOpenAI({
      apiKey: input.apiKey,
      baseURL: input.baseUrl ?? 'https://api.deepseek.com/v1',
    }).chat(input.modelId);
  }

  if (input.kind === 'xai') {
    if (!input.apiKey) throw new LLMError('not_configured', 'xai provider requires apiKey');
    return createOpenAI({
      apiKey: input.apiKey,
      baseURL: input.baseUrl ?? 'https://api.x.ai/v1',
    }).chat(input.modelId);
  }

  if (input.kind === 'mistral') {
    if (!input.apiKey) throw new LLMError('not_configured', 'mistral provider requires apiKey');
    return createOpenAI({
      apiKey: input.apiKey,
      baseURL: input.baseUrl ?? 'https://api.mistral.ai/v1',
    }).chat(input.modelId);
  }

  if (input.kind === 'kimi') {
    if (!input.apiKey) throw new LLMError('not_configured', 'kimi provider requires apiKey');
    return createOpenAI({
      apiKey: input.apiKey,
      baseURL: input.baseUrl ?? 'https://api.moonshot.ai/v1',
    }).chat(input.modelId);
  }

  if (input.kind === 'zhipu') {
    if (!input.apiKey) throw new LLMError('not_configured', 'zhipu provider requires apiKey');
    return createOpenAI({
      apiKey: input.apiKey,
      baseURL: input.baseUrl ?? 'https://open.bigmodel.cn/api/paas/v4',
    }).chat(input.modelId);
  }

  if (input.kind === 'openai-codex') {
    // Uses OpenAI Codex OAuth subscription token as API key
    if (!input.apiKey) throw new LLMError('not_configured', 'openai-codex provider requires apiKey (OAuth token)');
    return createOpenAI({
      apiKey: input.apiKey,
      baseURL: input.baseUrl ?? 'https://api.openai.com/v1',
    }).chat(input.modelId);
  }

  const exhaustive: never = input.kind;
  throw new LLMError('unsupported_kind', `unreachable: ${String(exhaustive)}`);
}
