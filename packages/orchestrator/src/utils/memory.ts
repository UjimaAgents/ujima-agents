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

  const seen = new Map<string, MemoryEntry>();
  for (const entry of repo.listOrgMemories(input.organizationId)) {
    if (entry.memberId === undefined) seen.set(entry.id, entry);
  }
  if (input.memberId) {
    for (const entry of repo.listMemories(input.organizationId, input.memberId)) {
      seen.set(entry.id, entry);
    }
  }

  let entries = [...seen.values()];
  const { kind, keyPrefix, query, limit } = input;
  if (kind) entries = entries.filter((entry) => entry.kind === kind);
  if (keyPrefix) entries = entries.filter((entry) => entry.key.startsWith(keyPrefix));
  if (query) entries = entries.filter((entry) => entry.content.includes(query));
  return entries.slice(0, limit ?? 20);
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
