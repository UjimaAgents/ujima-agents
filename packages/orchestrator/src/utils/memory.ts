import type { MemoryEntry } from '@ujima/shared';
import type { ApiRepository } from '../services/repository-reader.js';

type MemoryRepo = Pick<ApiRepository, 'listMemories' | 'listOrgMemories' | 'saveMemory' | 'deleteMemory'> & {
  upsertMemoryEntry?: (entry: MemoryEntry) => MemoryEntry;
  recallMemoryEntries?: (input: {
    organizationId: string;
    memberId?: string;
    kind?: MemoryEntry['kind'];
    keyPrefix?: string;
    query?: string;
    limit?: number;
    touch?: boolean;
  }) => MemoryEntry[];
  deleteMemoryEntry?: (
    organizationId: string,
    memberId: string | null,
    key: string,
  ) => boolean;
};

export function writeMemoryEntry(repo: MemoryRepo, entry: MemoryEntry): MemoryEntry {
  return repo.upsertMemoryEntry ? repo.upsertMemoryEntry(entry) : repo.saveMemory(entry);
}

export function recallMemoryEntries(repo: MemoryRepo, input: {
  organizationId: string;
  memberId?: string;
  kind?: MemoryEntry['kind'];
  keyPrefix?: string;
  query?: string;
  limit?: number;
  touch?: boolean;
}): MemoryEntry[] {
  if (repo.recallMemoryEntries) {
    return repo.recallMemoryEntries(input);
  }

  const nowIso = new Date().toISOString();
  const entries = repo
    .listOrgMemories(input.organizationId)
    .filter((entry) =>
      input.memberId === undefined
        ? true
        : entry.memberId === undefined || entry.memberId === input.memberId,
    )
    .filter((entry) => !entry.expiresAt || entry.expiresAt > nowIso);

  const { kind, keyPrefix, query, limit } = input;
  const filtered = entries
    .filter((entry) => !kind || entry.kind === kind)
    .filter((entry) => !keyPrefix || entry.key.startsWith(keyPrefix))
    .filter((entry) => !query || entry.content.includes(query))
    .sort(
      (a, b) =>
        Date.parse(b.lastRecalledAt ?? b.createdAt) - Date.parse(a.lastRecalledAt ?? a.createdAt),
    )
    .slice(0, limit ?? 20);

  if (input.touch) {
    for (const entry of filtered) {
      const touched = { ...entry, lastRecalledAt: nowIso };
      if (repo.upsertMemoryEntry) {
        repo.upsertMemoryEntry(touched);
      } else {
        repo.saveMemory(touched);
      }
    }
  }

  return filtered;
}

export function forgetMemoryEntry(
  repo: MemoryRepo,
  organizationId: string,
  memberId: string,
  key: string,
  scope: 'self' | 'org',
): boolean {
  if (repo.deleteMemoryEntry) {
    return repo.deleteMemoryEntry(organizationId, scope === 'org' ? null : memberId, key);
  }

  const entries = scope === 'org'
    ? repo.listOrgMemories(organizationId)
    : repo.listMemories(organizationId, memberId);
  let removed = false;
  for (const entry of entries) {
    if (entry.key === key && (scope === 'org' ? entry.memberId === undefined : entry.memberId === memberId)) {
      repo.deleteMemory(organizationId, entry.id);
      removed = true;
    }
  }
  return removed;
}
