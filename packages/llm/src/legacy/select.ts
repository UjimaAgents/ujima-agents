import { createAnthropicProvider } from './anthropic';
import { createOpenAICompatProvider } from './openai-compat';
import { createOllamaProvider } from './ollama';
import type { LLMProvider, ProviderId } from './types';
import { LLMError } from './types';

export interface ProviderConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  ollamaBaseUrl?: string;
  vscodeLmProvider?: LLMProvider;
}

export interface SelectProviderOptions {
  order?: ProviderId[];
  config?: ProviderConfig;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_ORDER: ProviderId[] = ['vscode-lm', 'anthropic', 'openai-compat', 'ollama'];

export function selectProvider(options: SelectProviderOptions = {}): LLMProvider {
  const { order = DEFAULT_ORDER, config = {}, env = process.env } = options;
  for (const id of order) {
    const p = tryCreate(id, config, env);
    if (p) return p;
  }
  throw new LLMError(
    'not_configured',
    `No LLM provider available (tried: ${order.join(', ')}). Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or run Ollama locally.`,
  );
}

function tryCreate(id: ProviderId, config: ProviderConfig, env: NodeJS.ProcessEnv): LLMProvider | undefined {
  switch (id) {
    case 'vscode-lm':
      return config.vscodeLmProvider;
    case 'anthropic': {
      const key = config.anthropicApiKey ?? env.ANTHROPIC_API_KEY;
      if (!key) return undefined;
      return createAnthropicProvider({ apiKey: key });
    }
    case 'openai-compat': {
      const key = config.openaiApiKey ?? env.OPENAI_API_KEY;
      if (!key) return undefined;
      return createOpenAICompatProvider({ apiKey: key, baseUrl: config.openaiBaseUrl ?? env.OPENAI_BASE_URL });
    }
    case 'ollama':
      return createOllamaProvider({ baseUrl: config.ollamaBaseUrl ?? env.OLLAMA_BASE_URL });
    case 'mock':
      return undefined;
  }
}
