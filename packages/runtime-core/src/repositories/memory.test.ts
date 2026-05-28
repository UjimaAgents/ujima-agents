import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryEntrySchema } from '@ujima/shared';
import { openDatabase } from '@ujima/context-store';
import { Repository } from './index.js';

describe('memory entries repository', () => {
  let repo: Repository;
  const organizationId = randomUUID();
  const memberId = randomUUID();
  const nowIso = new Date().toISOString();

  beforeEach(() => {
    repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  });

  function baseMemory(overrides: Record<string, unknown> = {}) {
    return MemoryEntrySchema.parse({
      id: randomUUID(),
      organizationId,
      memberId,
      kind: 'fact',
      key: 'test.key',
      content: 'Mason deleted the scheduler successfully.',
      metadata: {},
      createdAt: nowIso,
      ...overrides,
    });
  }

  it('creates and retrieves a memory entry', () => {
    const memory = baseMemory({ id: 'mem-1', key: 'quinn.lang', content: 'Quinn knows python.' });
    repo.upsertMemoryEntry(memory);

    const stored = repo.getMemory(organizationId, 'mem-1');
    expect(stored).not.toBeNull();
    expect(stored?.content).toBe('Quinn knows python.');
    expect(stored?.key).toBe('quinn.lang');
  });

  it('lists memory entries for a member', () => {
    const otherMemberId = randomUUID();
    repo.upsertMemoryEntry(baseMemory({ id: 'm1', memberId, key: 'a' }));
    repo.upsertMemoryEntry(baseMemory({ id: 'm2', memberId, key: 'b' }));
    repo.upsertMemoryEntry(baseMemory({ id: 'm3', memberId: otherMemberId, key: 'c' }));

    const list = repo.recallMemoryEntries({
      organizationId,
      memberId,
      limit: 10,
    });
    expect(list).toHaveLength(2);
    expect(list.some((m) => m.id === 'm1')).toBe(true);
    expect(list.some((m) => m.id === 'm2')).toBe(true);
    expect(list.some((m) => m.id === 'm3')).toBe(false);
  });

  it('lists org-scoped memory entries', () => {
    const otherOrgId = randomUUID();
    repo.upsertMemoryEntry(
      baseMemory({ id: 'o1', organizationId, key: 'org.a', memberId: undefined }),
    );
    repo.upsertMemoryEntry(
      baseMemory({ id: 'o2', organizationId: otherOrgId, key: 'org.b' }),
    );

    const list = repo.recallMemoryEntries({
      organizationId,
      memberId,
      limit: 10,
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('o1');
    expect(repo.listOrgMemories(organizationId)[0]?.memberId).toBeUndefined();
  });

  it('updates a memory entry on conflict', () => {
    repo.upsertMemoryEntry(
      baseMemory({
        id: 'u1',
        key: 'prefs.tone',
        kind: 'fact',
        content: 'Old text',
        metadata: { a: 1 },
      }),
    );
    repo.upsertMemoryEntry(
      baseMemory({
        id: 'u2',
        key: 'prefs.tone',
        kind: 'rule',
        content: 'New text',
        metadata: { b: 2 },
      }),
    );

    const stored = repo.recallMemoryEntries({
      organizationId,
      memberId,
      keyPrefix: 'prefs.',
      limit: 5,
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.kind).toBe('rule');
    expect(stored[0]?.content).toBe('New text');
    expect(stored[0]?.metadata).toEqual({ b: 2 });
  });

  it('saveMemory preserves key and ttl fields', () => {
    repo.saveMemory(
      baseMemory({
        id: 's1',
        key: 'prefs.tone',
        content: 'Be concise.',
        expiresAt: '2030-01-01T00:00:00.000Z',
        sourceMessageId: 'msg-1',
        lastRecalledAt: '2029-12-31T23:59:00.000Z',
      }),
    );
    repo.saveMemory(
      baseMemory({
        id: 's2',
        key: 'prefs.tone',
        kind: 'rule',
        content: 'Be very concise.',
        metadata: { updated: true },
        expiresAt: '2030-02-01T00:00:00.000Z',
        sourceMessageId: 'msg-2',
        lastRecalledAt: '2030-01-31T23:59:00.000Z',
      }),
    );

    const stored = repo.recallMemoryEntries({
      organizationId,
      memberId,
      keyPrefix: 'prefs.',
      limit: 5,
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      key: 'prefs.tone',
      kind: 'rule',
      content: 'Be very concise.',
      metadata: { updated: true },
      expiresAt: '2030-02-01T00:00:00.000Z',
      sourceMessageId: 'msg-2',
      lastRecalledAt: '2030-01-31T23:59:00.000Z',
    });
  });

  it('deletes a memory entry', () => {
    repo.upsertMemoryEntry(baseMemory({ id: 'd1', key: 'temp.note' }));
    expect(repo.deleteMemoryEntry(organizationId, memberId, 'temp.note')).toBe(true);
    expect(
      repo.recallMemoryEntries({ organizationId, memberId, keyPrefix: 'temp.', limit: 5 }),
    ).toHaveLength(0);
  });
});
