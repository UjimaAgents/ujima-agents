import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryEntry } from '@ujima/shared';
import { forgetMemoryEntry, recallMemoryEntries } from './memory.js';

describe('memory fallback helpers', () => {
  const organizationId = 'org-1';
  const memberId = 'member-1';

  let repo: {
    listOrgMemories: ReturnType<typeof vi.fn>;
    listMemories: ReturnType<typeof vi.fn>;
    saveMemory: ReturnType<typeof vi.fn>;
    deleteMemory: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-01T12:00:00.000Z'));

    repo = {
      listOrgMemories: vi.fn(),
      listMemories: vi.fn(),
      saveMemory: vi.fn((entry: MemoryEntry) => entry),
      deleteMemory: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('filters expired entries and touches recalled entries', () => {
    repo.listOrgMemories.mockReturnValue([
      {
        id: 'other',
        organizationId,
        memberId: 'member-2',
        kind: 'fact',
        key: 'other.note',
        content: 'Other member',
        metadata: {},
        createdAt: '2025-03-01T08:00:00.000Z',
      },
      {
        id: 'expired',
        organizationId,
        memberId,
        kind: 'fact',
        key: 'old.note',
        content: 'Expired',
        metadata: {},
        expiresAt: '2000-01-01T00:00:00.000Z',
        createdAt: '2025-02-01T08:00:00.000Z',
      },
      {
        id: 'self',
        organizationId,
        memberId,
        kind: 'fact',
        key: 'self.note',
        content: 'Personal note',
        metadata: {},
        createdAt: '2025-03-01T10:00:00.000Z',
      },
      {
        id: 'shared',
        organizationId,
        memberId: undefined,
        kind: 'fact',
        key: 'shared.note',
        content: 'Shared note',
        metadata: {},
        createdAt: '2025-03-01T11:00:00.000Z',
      },
    ] satisfies MemoryEntry[]);

    const entries = recallMemoryEntries(
      {
        listOrgMemories: repo.listOrgMemories,
        listMemories: repo.listMemories,
        saveMemory: repo.saveMemory,
        deleteMemory: repo.deleteMemory,
      },
      {
        organizationId,
        memberId,
        limit: 10,
        touch: true,
      },
    );

    expect(entries.map((entry) => entry.id)).toEqual(['shared', 'self']);
    expect(repo.saveMemory).toHaveBeenCalledTimes(2);
    expect(repo.saveMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'shared',
        lastRecalledAt: '2025-03-01T12:00:00.000Z',
      }),
    );
  });

  it('forgets org-scoped entries by key', () => {
    repo.listOrgMemories.mockReturnValue([
      {
        id: 'shared',
        organizationId,
        memberId: undefined,
        kind: 'fact',
        key: 'shared.note',
        content: 'Shared note',
        metadata: {},
        createdAt: '2025-03-01T11:00:00.000Z',
      },
    ] satisfies MemoryEntry[]);

    const removed = forgetMemoryEntry(
      {
        listOrgMemories: repo.listOrgMemories,
        listMemories: repo.listMemories,
        saveMemory: repo.saveMemory,
        deleteMemory: repo.deleteMemory,
      },
      organizationId,
      memberId,
      'shared.note',
      'org',
    );

    expect(removed).toBe(true);
    expect(repo.deleteMemory).toHaveBeenCalledWith(organizationId, 'shared');
  });
});
