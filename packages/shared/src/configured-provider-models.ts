import { defaultModelForProvider, getModelOptionsForProvider } from './model-catalog.js';

export interface ConfiguredProviderModelOption {
  provider: string;
  model: string;
  label: string;
  selectedLabel: string;
  value: string;
}

export function listConfiguredProviderModels(
  providers: readonly { name: string; hasKey: boolean }[],
  formatSelectedLabel: (provider: string, model: string) => string = (provider, model) =>
    `${provider} · ${model}`,
): ConfiguredProviderModelOption[] {
  const options: ConfiguredProviderModelOption[] = [];
  for (const entry of providers) {
    if (!entry.hasKey) continue;
    for (const modelOption of getModelOptionsForProvider(entry.name)) {
      options.push({
        provider: entry.name,
        model: modelOption.value,
        label: modelOption.label,
        selectedLabel: formatSelectedLabel(entry.name, modelOption.label),
        value: `${entry.name}::${modelOption.value}`,
      });
    }
  }
  return options;
}

export function parseConfiguredProviderModelValue(
  value: string,
): { provider: string; model: string } | null {
  const separator = value.indexOf('::');
  if (separator <= 0) return null;
  const provider = value.slice(0, separator);
  const model = value.slice(separator + 2);
  if (!provider || !model) return null;
  return { provider, model };
}

export function configuredProviderModelValue(
  provider: string,
  model: string,
): string {
  return `${provider}::${model}`;
}

export function resolveMemberModelSelection(
  member: { llm?: string; model?: string },
  providers: readonly { name: string; hasKey: boolean }[],
): string {
  const configured = listConfiguredProviderModels(providers);
  if (member.llm && member.model) {
    const candidate = configuredProviderModelValue(member.llm, member.model);
    if (configured.some((option) => option.value === candidate)) {
      return candidate;
    }
  }
  const first = configured[0];
  if (first) return first.value;
  const fallbackProvider = providers.find((p) => p.hasKey)?.name ?? 'openai';
  return configuredProviderModelValue(fallbackProvider, defaultModelForProvider(fallbackProvider));
}
