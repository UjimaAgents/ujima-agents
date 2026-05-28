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
      content: 'Mason deleted the scheduler successfully.',
      metadata: {},
      createdAt: nowIso,
      ...overrides,
    });
  }

  it('creates and retrieves a memory entry', () => {
    const memory = baseMemory({ id: 'mem-1', content: 'Quinn knows python.' });
    repo.saveMemory(memory);

    const stored = repo.getMemory(organizationId, 'mem-1');
    expect(stored).not.toBeNull();
    expect(stored?.content).toBe('Quinn knows python.');
    expect(stored?.kind).toBe('fact');
  });

  it('lists memory entries for a member', () => {
    const otherMemberId = randomUUID();
    repo.saveMemory(baseMemory({ id: 'm1', memberId }));
    repo.saveMemory(baseMemory({ id: 'm2', memberId }));
    repo.saveMemory(baseMemory({ id: 'm3', memberId: otherMemberId }));

    const list = repo.listMemories(organizationId, memberId);
    expect(list).toHaveLength(2);
    expect(list.some((m) => m.id === 'm1')).toBe(true);
    expect(list.some((m) => m.id === 'm2')).toBe(true);
    expect(list.some((m) => m.id === 'm3')).toBe(false);
  });

  it('lists memory entries for an organization', () => {
    const otherOrgId = randomUUID();
    repo.saveMemory(baseMemory({ id: 'o1', organizationId }));
    repo.saveMemory(baseMemory({ id: 'o2', organizationId: otherOrgId }));

    const list = repo.listOrgMemories(organizationId);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('o1');
  });

  it('updates a memory entry on conflict', () => {
    repo.saveMemory(
      baseMemory({
        id: 'u1',
        kind: 'fact',
        content: 'Old text',
        metadata: { a: 1 },
      }),
    );
    repo.saveMemory(
      baseMemory({
        id: 'u1',
        kind: 'decision',
        content: 'New text',
        metadata: { b: 2 },
      }),
    );

    const stored = repo.getMemory(organizationId, 'u1');
    expect(stored?.kind).toBe('decision');
    expect(stored?.content).toBe('New text');
    expect(stored?.metadata).toEqual({ b: 2 });
  });

  it('deletes a memory entry', () => {
    repo.saveMemory(baseMemory({ id: 'd1' }));
    repo.deleteMemory(organizationId, 'd1');

    expect(repo.getMemory(organizationId, 'd1')).toBeNull();
  });
});
