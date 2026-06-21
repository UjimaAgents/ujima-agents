import type { MemoryEntry } from '@ujima/shared';
import type { ApiRepository } from '../services/repository-reader.js';

type MemoryRepo = Pick<ApiRepository, 'listMemories' | 'listOrgMemories' | 'saveMemory' | 'deleteMemory'> & {
  upsertMemoryEntry?: (entry: MemoryEntry) => Promise<MemoryEntry> | MemoryEntry;
  recallMemoryEntries?: (input: {
    organizationId: string;
    memberId?: string;
    kind?: MemoryEntry['kind'];
    keyPrefix?: string;
    query?: string;
    limit?: number;
    touch?: boolean;
  }) => Promise<MemoryEntry[]> | MemoryEntry[];
  deleteMemoryEntry?: (
    organizationId: string,
    memberId: string | null,
    key: string,
  ) => Promise<boolean> | boolean;
};

export async function writeMemoryEntry(repo: MemoryRepo, entry: MemoryEntry): Promise<MemoryEntry> {
  if (!repo.upsertMemoryEntry) {
    throw new Error('memory is not available');
  }
  return await repo.upsertMemoryEntry(entry);
}

export async function recallMemoryEntries(repo: MemoryRepo, input: {
  organizationId: string;
  memberId?: string;
  kind?: MemoryEntry['kind'];
  keyPrefix?: string;
  query?: string;
  limit?: number;
  touch?: boolean;
}): Promise<MemoryEntry[]> {
  if (!repo.recallMemoryEntries) {
    throw new Error('memory is not available');
  }
  return await repo.recallMemoryEntries(input);
}

export async function forgetMemoryEntry(
  repo: MemoryRepo,
  organizationId: string,
  memberId: string,
  key: string,
  scope: 'self' | 'org',
): Promise<boolean> {
  if (!repo.deleteMemoryEntry) {
    throw new Error('memory is not available');
  }
  return await repo.deleteMemoryEntry(organizationId, scope === 'org' ? null : memberId, key);
}
