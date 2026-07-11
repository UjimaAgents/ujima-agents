import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel } from 'ai';
import type { ReasoningEffort } from '@ujima/shared';
import { clampReasoningEffortForProvider } from '@ujima/shared';
import { createCodexResponsesModel } from './codex-responses.js';
import { createClaudeCodeModel } from './claude-code-sdk.js';
import { LLMError, PROVIDER_KINDS, type ProviderKind } from './types.js';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

/**
 * Default OpenAI-compatible base URL for kinds that expose a `/v1/models`
 * endpoint. Returns `undefined` for kinds whose model list is not discoverable
 * via the OpenAI shape (anthropic, google native SDKs, codex).
 */
export function getDefaultOpenAiCompatBaseUrl(kind: ProviderKind): string | undefined {
  switch (kind) {
    case 'openai': return 'https://api.openai.com/v1';
    case 'openrouter': return OPENROUTER_BASE_URL;
    case 'ollama': return DEFAULT_OLLAMA_BASE_URL;
    case 'deepseek': return DEEPSEEK_BASE_URL;
    case 'xai': return 'https://api.x.ai/v1';
    case 'mistral': return 'https://api.mistral.ai/v1';
    case 'kimi': return 'https://api.moonshot.ai/v1';
    case 'zhipu': return 'https://open.bigmodel.cn/api/paas/v4';
    default: return undefined;
  }
}

function reasoningSettings(
  kind: ProviderKind,
  reasoningEffort?: ReasoningEffort,
  modelId?: string,
) {
  const effort = clampReasoningEffortForProvider(kind, reasoningEffort, modelId);
  if (effort === 'none') return null;
  if (kind === 'google') {
    return defaultSettingsMiddleware({
      settings: {
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingLevel: effort === 'extra_high' ? 'high' : effort,
              includeThoughts: true,
            },
          },
        },
      },
    });
  }

  const openAiEffort = effort === 'extra_high' ? 'xhigh' : effort;
  if (kind === 'anthropic') {
    return defaultSettingsMiddleware({
      settings: {
        providerOptions: {
          anthropic: {
            effort: (openAiEffort === 'xhigh' ? 'high' : openAiEffort) as 'low' | 'medium' | 'high',
          },
        },
      },
    });
  }

  return defaultSettingsMiddleware({
    settings: {
      providerOptions: {
        openai: { reasoningEffort: openAiEffort as 'low' | 'medium' | 'high' | 'xhigh' },
      },
    },
  });
}

/**
 * Enables provider-native reasoning defaults for **official** SDK adapters only.
 *
 * Do **not** apply this to OpenAI-*compatible* HTTP proxies (Moonshot, Zhipu, OpenRouter,
 * DeepSeek, etc.): `providerOptions.openai.reasoningEffort` is forwarded and can put the
 * remote model into "thinking" mode that requires `reasoning_content` to be echoed on every
 * follow-up turn. Our chat history is rebuilt from persisted {@link Message} rows, so we
 * only enable this where we also persist reasoning (see orchestrator `reasoningContent`).
 */
function withReasoning(
  model: LanguageModel,
  kind: ProviderKind,
  reasoningEffort?: ReasoningEffort,
  modelId?: string,
): LanguageModel {
  const middleware = reasoningSettings(kind, reasoningEffort, modelId);
  if (!middleware) return model;
  return wrapLanguageModel({
    model: model as LanguageModelV3,
    middleware,
  }) as LanguageModel;
}

export interface SelectLanguageModelInput {
  /** Provider kind. See {@link ProviderKind}. */
  kind: ProviderKind;
  /** Model id (e.g. `claude-opus-4-7`, `gpt-4o-mini`, `anthropic/claude-opus-4-7`). */
  modelId: string;
  /** Working directory used by providers that need a repo-local app-server. */
  cwd?: string;
  /** API key. Required for all kinds except `ollama` (which only uses `baseUrl`). */
  apiKey?: string;
  /** Custom base URL. For `openrouter` defaults to the public router; for `ollama` defaults to `http://127.0.0.1:11434/v1`. */
  baseUrl?: string;
  reasoningEffort?: ReasoningEffort;
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
    return withReasoning(
      createAnthropic({ apiKey: input.apiKey }).messages(input.modelId),
      input.kind,
      input.reasoningEffort,
      input.modelId,
    );
  }

  if (input.kind === 'openai') {
    if (!input.apiKey) throw new LLMError('not_configured', 'openai provider requires apiKey');
    return withReasoning(
      createOpenAI({ apiKey: input.apiKey }).responses(input.modelId),
      input.kind,
      input.reasoningEffort,
      input.modelId,
    );
  }

  if (input.kind === 'google') {
    if (!input.apiKey) throw new LLMError('not_configured', 'google provider requires apiKey');
    return withReasoning(
      createGoogleGenerativeAI({ apiKey: input.apiKey }).languageModel(input.modelId),
      input.kind,
      input.reasoningEffort,
      input.modelId,
    );
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
    // DeepSeek's direct chat API rejects multimodal `image_url`
    // blocks. The official SDK silently drops non-text parts so the
    // run still completes against the sender's text + inventory
    // block; vision-capable DeepSeek lives behind OpenRouter.
    return createDeepSeek({
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
    const accessToken = input.apiKey ?? process.env.UJIMA_CODEX_ACCESS_TOKEN ?? process.env.CHATGPT_ACCESS_TOKEN;
    if (!accessToken) {
      throw new LLMError('not_configured', 'openai-codex responses transport requires apiKey or UJIMA_CODEX_ACCESS_TOKEN');
    }

    return withReasoning(
      createCodexResponsesModel({
        modelId: input.modelId,
        accessToken,
        baseUrl: input.baseUrl,
      }),
      input.kind,
      input.reasoningEffort,
      input.modelId,
    );
  }

  if (input.kind === 'anthropic-claude-code') {
    // Claude Code auth is handled by the SDK reading ~/.claude/ credentials
    // The SDK launches the `claude` CLI as a subprocess which handles auth internally
    return withReasoning(
      createClaudeCodeModel({
        modelId: input.modelId,
      }),
      input.kind,
      input.reasoningEffort,
      input.modelId,
    );
  }

  const exhaustive: never = input.kind;
  throw new LLMError('unsupported_kind', `unreachable: ${String(exhaustive)}`);
}

function normalizeDeepSeekModelId(modelId: string): string {
  const normalized = modelId.trim().toLowerCase();
  if (normalized === 'deepseek-chat-v2') {
    return 'deepseek-v4-flash';
  }
  if (normalized === 'deepseek-chat' || normalized === 'deepseek-reasoner') {
    return 'deepseek-v4-flash';
  }
  return modelId;
}
