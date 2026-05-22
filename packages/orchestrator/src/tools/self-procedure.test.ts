import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadProceduresFile,
  proceduresPath,
  selfProcedureAddTool,
  selfProcedureRemoveTool,
  PROCEDURE_FILE_MAX_BYTES,
} from './self-procedure.js';

// Bet 7 — procedural memory. Per-agent playbook file the agent owns
// and edits. Loaded into the cache-stable Zone 2 of the system
// prompt at wake time. These tests cover: write → read round-trip,
// dedup of identical entries, removal by index, and the byte cap
// eviction so the file doesn't bloat the cacheable prefix.

let workspaceRoot: string;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'ujima-procedures-'));
});
afterEach(async () => {
  if (workspaceRoot && existsSync(workspaceRoot)) {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

function ctx(memberId: string, args: Record<string, unknown>) {
  return {
    invocation: {
      organizationId: 'org-1',
      memberId,
      runId: 'run-1',
      threadId: 'thread-1',
      action: 'message' as const,
      resourceType: 'message' as const,
      input: args,
    },
    team: { workspace: { root: workspaceRoot } } as never,
    repo: {} as never,
    conversations: {} as never,
    reportProgress: undefined,
  };
}

describe('selfProcedureAddTool', () => {
  it('creates the file on first add and persists when + then on disk', async () => {
    const result = await selfProcedureAddTool.execute(
      ctx('layla', {
        when: 'pinging Phoebe in #design on a long thread',
        then: 'include the artifact path explicitly',
      }) as never,
    );
    expect((result as { ok: boolean; added: boolean; count: number }).added).toBe(true);
    expect((result as { count: number }).count).toBe(1);

    const path = proceduresPath(workspaceRoot, 'layla');
    expect(existsSync(path)).toBe(true);
    const body = await readFile(path, 'utf8');
    expect(body).toContain('**When** pinging Phoebe in #design');
    expect(body).toContain('**then** include the artifact path explicitly');
  });

  it('dedups exact duplicates (same when + same then) and reports added=false', async () => {
    await selfProcedureAddTool.execute(
      ctx('layla', { when: 'on Mondays', then: 'reply tersely' }) as never,
    );
    const second = await selfProcedureAddTool.execute(
      ctx('layla', { when: 'on Mondays', then: 'reply tersely' }) as never,
    );
    expect((second as { added: boolean; reason: string }).added).toBe(false);
    expect((second as { reason: string }).reason).toBe('duplicate');
  });

  it('treats paraphrased entries as distinct (not fuzzy)', async () => {
    await selfProcedureAddTool.execute(
      ctx('layla', { when: 'on Mondays', then: 'reply tersely' }) as never,
    );
    const second = await selfProcedureAddTool.execute(
      ctx('layla', { when: 'on Mondays', then: 'be terse' }) as never,
    );
    expect((second as { added: boolean }).added).toBe(true);
    expect((second as { count: number }).count).toBe(2);
  });
});

describe('selfProcedureRemoveTool', () => {
  it('removes by 1-based index and persists the new list', async () => {
    await selfProcedureAddTool.execute(
      ctx('layla', { when: 'A', then: 'do alpha' }) as never,
    );
    await selfProcedureAddTool.execute(
      ctx('layla', { when: 'B', then: 'do beta' }) as never,
    );
    const removeRes = await selfProcedureRemoveTool.execute(
      ctx('layla', { index: 1 }) as never,
    );
    expect((removeRes as { ok: boolean; count: number }).ok).toBe(true);
    expect((removeRes as { count: number }).count).toBe(1);

    const loaded = await loadProceduresFile(workspaceRoot, 'layla');
    expect(loaded?.entries.map((e) => e.when)).toEqual(['B']);
  });

  it('rejects out-of-range indexes', async () => {
    await selfProcedureAddTool.execute(
      ctx('layla', { when: 'only', then: 'do it' }) as never,
    );
    const res = await selfProcedureRemoveTool.execute(
      ctx('layla', { index: 9 }) as never,
    );
    expect((res as { ok: boolean }).ok).toBe(false);
  });

  it('returns ok=false when there is no file yet', async () => {
    const res = await selfProcedureRemoveTool.execute(
      ctx('layla', { index: 1 }) as never,
    );
    expect((res as { ok: boolean }).ok).toBe(false);
  });
});

describe('procedures cap — file stays under PROCEDURE_FILE_MAX_BYTES', () => {
  it('evicts oldest entries when the new total would exceed the cap', async () => {
    // 60 entries × ~80 bytes each ≈ 4.8 KB — exceeds 4 KB cap.
    for (let i = 0; i < 60; i += 1) {
      await selfProcedureAddTool.execute(
        ctx('layla', {
          when: `condition ${i} is encountered in long workflow`,
          then: `apply remedy ${i} which is documented elsewhere in the BRD`,
        }) as never,
      );
    }
    const loaded = await loadProceduresFile(workspaceRoot, 'layla');
    expect(loaded).not.toBeNull();
    expect(Buffer.byteLength(loaded!.raw, 'utf8')).toBeLessThanOrEqual(PROCEDURE_FILE_MAX_BYTES);
    // The oldest entries were evicted — entry 0 should be gone,
    // entry 59 should remain.
    const haveLatest = loaded!.entries.some((e) => e.when.includes('59'));
    const haveOldest = loaded!.entries.some((e) => e.when.includes('condition 0 '));
    expect(haveLatest).toBe(true);
    expect(haveOldest).toBe(false);
  });
});
