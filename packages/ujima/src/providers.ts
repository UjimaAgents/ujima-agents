import { ProviderConfigSchema, type ProviderConfig } from './schemas.js';

export function defineProvider(provider: unknown): ProviderConfig {
  return ProviderConfigSchema.parse(provider);
}

export function normalizeProviderKey(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  return normalized === 'zhipu-ai' || normalized === 'z.ai' || normalized === 'z-ai' ? 'zhipu' : normalized;
}

export function normalizeProviders(
  providers: Record<string, unknown> = {},
): Record<string, ProviderConfig> {
  return Object.fromEntries(
    Object.entries(providers).map(([name, provider]) => [
      normalizeProviderKey(name),
      ProviderConfigSchema.parse(provider),
    ]),
  );
}
