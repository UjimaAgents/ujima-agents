import { getModelOptionsForProvider } from './model-catalog.js';

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
): string {
  if (member.llm && member.model) {
    return configuredProviderModelValue(member.llm, member.model);
  }
  if (member.model) return member.model;
  return "";
}
