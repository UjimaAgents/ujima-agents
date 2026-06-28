import type { ApiRepository } from '../services/repository-reader.js';

export function writeSecretMap(
  repo: ApiRepository,
  map: Record<string, string> | undefined,
): string | undefined {
  if (!map || Object.keys(map).length === 0) return undefined;
  return repo.writeSecret(JSON.stringify(map));
}

export function deleteSecretIfPresent(repo: ApiRepository, keyRef: string | undefined): void {
  if (keyRef) repo.deleteSecret(keyRef);
}

export function readSecretMap(repo: ApiRepository, keyRef: string | undefined): Record<string, string> {
  if (!keyRef) return {};
  const raw = repo.readSecret(keyRef);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof key === 'string' && typeof value === 'string') {
          out[key] = value;
        }
      }
      return out;
    }
  } catch {
    // Corrupt secret blob — return empty rather than throwing so the
    // settings page can still render and the operator can fix it.
  }
  return {};
}
