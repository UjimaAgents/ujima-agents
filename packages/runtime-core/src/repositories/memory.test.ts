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

  it('creates and retrieves a memory entry', async () => {
    const memory = baseMemory({ id: 'mem-1', key: 'quinn.lang', content: 'Quinn knows python.' });
    await repo.upsertMemoryEntry(memory);

    const stored = repo.getMemory(organizationId, 'mem-1');
    expect(stored).not.toBeNull();
    expect(stored?.content).toBe('Quinn knows python.');
    expect(stored?.key).toBe('quinn.lang');
  });

  it('recalls memory entries by query', async () => {
    await repo.upsertMemoryEntry(baseMemory({ id: 'm1', key: 'lang.python', content: 'Carter knows python and bun.' }));
    await repo.upsertMemoryEntry(baseMemory({ id: 'm2', key: 'lang.ruby', content: 'Carter knows ruby too.' }));

    const recalled = await repo.recallMemoryEntries({
      organizationId,
      memberId,
      query: 'python',
      limit: 5,
    });

    expect(recalled.map((entry) => entry.id)).toEqual(['m1']);
  });

  it('recalls with fuzzy matching for typos', async () => {
    await repo.upsertMemoryEntry(baseMemory({ id: 'm1', key: 'deployment.config', content: 'Deploy config is in us-west-2.' }));
    await repo.upsertMemoryEntry(baseMemory({ id: 'm2', key: 'user.preferences', content: 'User prefers concise replies.' }));

    // "deploy config" should fuzzy-match "deployment.config"
    const fuzzy = await repo.recallMemoryEntries({
      organizationId,
      memberId,
      query: 'deploy config',
      limit: 5,
    });

    expect(fuzzy.length).toBeGreaterThanOrEqual(1);
    expect(fuzzy[0]?.id).toBe('m1');
  });

  it('deletes a memory entry', async () => {
    await repo.upsertMemoryEntry(baseMemory({ id: 'd1', key: 'temp.note' }));
    expect(await repo.deleteMemoryEntry(organizationId, memberId, 'temp.note')).toBe(true);
    expect(
      await repo.recallMemoryEntries({ organizationId, memberId, keyPrefix: 'temp.', limit: 5 }),
    ).toHaveLength(0);
  });
});
