import { ProviderConfigSchema, type ProviderConfig } from './schemas.js';

export function defineProvider(provider: unknown): ProviderConfig {
  return ProviderConfigSchema.parse(provider);
}

export function normalizeProviders(
  providers: Record<string, unknown> = {},
): Record<string, ProviderConfig> {
  return Object.fromEntries(
    Object.entries(providers).map(([name, provider]) => [
      name,
      ProviderConfigSchema.parse(provider),
    ]),
  );
}
