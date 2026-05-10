import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel } from 'ai';
import { LLMError, PROVIDER_KINDS, type ProviderKind } from './types.js';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

const DEFAULT_REASONING_SETTINGS = defaultSettingsMiddleware({
  settings: {
    providerOptions: {
      openai: { reasoningEffort: 'medium' },
      anthropic: { effort: 'medium' },
    },
  },
});

/**
 * Enables provider-native reasoning defaults for **official** SDK adapters only.
 *
 * Do **not** apply this to OpenAI-*compatible* HTTP proxies (Moonshot, Zhipu, OpenRouter,
 * DeepSeek, etc.): `providerOptions.openai.reasoningEffort` is forwarded and can put the
 * remote model into "thinking" mode that requires `reasoning_content` to be echoed on every
 * follow-up turn. Our chat history is rebuilt from persisted {@link Message} rows, so we
 * only enable this where we also persist reasoning (see orchestrator `reasoningContent`).
 */
function withDefaultReasoning(model: LanguageModel): LanguageModel {
  return wrapLanguageModel({
    model: model as LanguageModelV3,
    middleware: DEFAULT_REASONING_SETTINGS,
  }) as LanguageModel;
}

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
    return withDefaultReasoning(createAnthropic({ apiKey: input.apiKey }).messages(input.modelId));
  }

  if (input.kind === 'openai') {
    if (!input.apiKey) throw new LLMError('not_configured', 'openai provider requires apiKey');
    return withDefaultReasoning(createOpenAI({ apiKey: input.apiKey }).responses(input.modelId));
  }

  if (input.kind === 'google') {
    if (!input.apiKey) throw new LLMError('not_configured', 'google provider requires apiKey');
    return withDefaultReasoning(createGoogleGenerativeAI({ apiKey: input.apiKey }).languageModel(input.modelId));
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
    // Use DeepSeek's OpenAI-compatible endpoint instead of the dedicated
    // DeepSeek SDK adapter to avoid model-spec version mismatches across
    // mixed AI SDK runtimes (v5/v6 paths).
    return createOpenAI({
      apiKey: input.apiKey,
      baseURL: input.baseUrl ?? DEEPSEEK_BASE_URL,
    }).chat(normalizeDeepSeekModelId(input.modelId));
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

function normalizeDeepSeekModelId(modelId: string): string {
  const normalized = modelId.trim().toLowerCase();
  if (normalized === 'deepseek-chat-v2') {
    return 'deepseek-chat';
  }
  if (normalized === 'deepseek-v4-flash' || normalized === 'deepseek-v4-pro') {
    return 'deepseek-chat';
  }
  return modelId;
}
