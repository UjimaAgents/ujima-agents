import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { procedureTool } from './procedure.js';

let workspaceRoot: string;
const memberId = 'agent-test-1';

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'ujima-procedure-unified-'));
});
afterEach(async () => {
  if (workspaceRoot && existsSync(workspaceRoot)) {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

function fakeInvocation(args: Record<string, unknown>) {
  return {
    invocation: {
      organizationId: 'org-1',
      runId: 'run-1',
      memberId,
      input: args,
      action: 'message',
      resourceType: 'message',
    },
    team: { workspace: { root: workspaceRoot } },
    repo: {},
  } as never;
}

describe('procedure (unified tool)', () => {
  it('adds a self-scope procedure', async () => {
    const result = (await procedureTool.execute(
      fakeInvocation({
        scope: 'self',
        operation: 'add',
        name: 'use-bullet-replies',
        description: 'When status reports run long use bullets.',
        body: 'When: status report > 5 lines\nThen: use bullets',
      }),
    )) as { ok: boolean; added: boolean; name: string; count: number; path: string };
    expect(result.ok).toBe(true);
    expect(result.added).toBe(true);
    expect(result.name).toBe('use-bullet-replies');
    expect(result.count).toBe(1);
    const raw = await readFile(result.path, 'utf8');
    expect(raw).toContain('name: use-bullet-replies');
  });

  it('lists self-scope procedures', async () => {
    await procedureTool.execute(
      fakeInvocation({
        scope: 'self',
        operation: 'add',
        name: 'first',
        description: 'First procedure.',
        body: 'When: first\nThen: do first',
      }),
    );
    await procedureTool.execute(
      fakeInvocation({
        scope: 'self',
        operation: 'add',
        name: 'second',
        description: 'Second procedure.',
        body: 'When: second\nThen: do second',
      }),
    );
    const result = (await procedureTool.execute(
      fakeInvocation({ scope: 'self', operation: 'list' }),
    )) as { procedures: { name: string }[] };
    expect(result.procedures).toHaveLength(2);
    expect(result.procedures.map((p) => p.name).sort()).toEqual(['first', 'second']);
  });

  it('views a self-scope procedure by name', async () => {
    await procedureTool.execute(
      fakeInvocation({
        scope: 'self',
        operation: 'add',
        name: 'view-me',
        description: 'Test view.',
        body: 'When: viewing\nThen: show body',
      }),
    );
    const result = (await procedureTool.execute(
      fakeInvocation({ scope: 'self', operation: 'view', name: 'view-me' }),
    )) as { ok: boolean; name: string; body: string };
    expect(result.ok).toBe(true);
    expect(result.name).toBe('view-me');
    expect(result.body).toContain('When: viewing');
  });

  it('removes a self-scope procedure', async () => {
    const addResult = (await procedureTool.execute(
      fakeInvocation({
        scope: 'self',
        operation: 'add',
        name: 'temp',
        description: 'Temporary procedure.',
        body: 'When: temp\nThen: remove',
      }),
    )) as { path: string };
    expect(existsSync(addResult.path)).toBe(true);
    const removeResult = (await procedureTool.execute(
      fakeInvocation({ scope: 'self', operation: 'remove', name: 'temp' }),
    )) as { ok: boolean; removed: string; count: number };
    expect(removeResult.ok).toBe(true);
    expect(removeResult.removed).toBe('temp');
    expect(removeResult.count).toBe(0);
    expect(existsSync(addResult.path)).toBe(false);
  });

  it('rejects add/remove/update in non-self scopes', async () => {
    for (const op of ['add', 'remove', 'update'] as const) {
      await expect(
        procedureTool.execute(
          fakeInvocation({
            scope: 'org',
            operation: op,
            name: 'test',
            description: 'test',
            body: 'When: test\nThen: test',
          }),
        ),
      ).rejects.toThrow(`${op} is only supported in 'self' scope`);
    }
  });
});
