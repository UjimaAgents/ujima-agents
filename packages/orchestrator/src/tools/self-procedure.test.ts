import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listProcedures,
  loadProceduresFile,
  loadProceduresForSystemPrompt,
  proceduresDirPath,
  selfProcedureAddTool,
  selfProcedureListTool,
  selfProcedureRemoveTool,
  selfProcedureViewTool,
} from './self-procedure.js';

// Bet 2 (post-Hermes review) — procedures live as one file per
// playbook in `ai/memory-bank/agents/<member>/procedures/<slug>.md`
// with YAML-ish frontmatter. The system prompt loads only
// `name: description` lines; the agent calls `self.procedure.view`
// to pull a body on demand.

let workspaceRoot: string;
const memberId = 'agent-test-1';

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'ujima-procedures-'));
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
  } as never;
}

describe('self.procedure.add', () => {
  it('creates a procedure file with frontmatter and lists it', async () => {
    const result = (await selfProcedureAddTool.execute(
      fakeInvocation({
        name: 'use-bullet-replies',
        description: 'When the user asks for a status, reply in 3 bullets max.',
        body: 'When: user asks for status\nThen: reply in 3 bullets max',
      }),
    )) as { ok: boolean; added: boolean; name: string; count: number; path: string };
    expect(result.ok).toBe(true);
    expect(result.added).toBe(true);
    expect(result.name).toBe('use-bullet-replies');
    expect(result.count).toBe(1);
    const raw = await readFile(result.path, 'utf8');
    expect(raw).toContain('name: use-bullet-replies');
    expect(raw).toContain('description:');
    expect(raw).toContain('When: user asks for status');
  });

  it('rejects duplicate names without overwriting', async () => {
    await selfProcedureAddTool.execute(
      fakeInvocation({
        name: 'one-thing',
        description: 'Do the one thing properly.',
        body: 'When: anything happens\nThen: do the one thing',
      }),
    );
    const second = (await selfProcedureAddTool.execute(
      fakeInvocation({
        name: 'one-thing',
        description: 'Different description.',
        body: 'Different body.',
      }),
    )) as { ok: boolean; reason?: string };
    expect(second.ok).toBe(false);
    expect(second.reason).toContain('already exists');
  });

  it('exposes the name-slug Zod schema for the AI-SDK to validate', () => {
    // Zod enforcement happens at the AI-SDK layer (the tool palette
    // is built from `schema` and the model's call is validated
    // there). The execute() method receives already-parsed args.
    // Confirm the schema rejects spaced/mixed-case names so the
    // upstream contract is correct.
    const result = selfProcedureAddTool.schema.safeParse({
      name: 'Bad Name',
      description: 'Has spaces and capitals which break the slug rule.',
      body: 'Body must be at least eight characters long.',
    });
    expect(result.success).toBe(false);
  });
});

describe('self.procedure.list / view', () => {
  it('list returns name + description only; view returns the full body', async () => {
    await selfProcedureAddTool.execute(
      fakeInvocation({
        name: 'first-rule',
        description: 'First rule of fight club.',
        body: 'When: someone joins\nThen: do not talk about fight club',
      }),
    );
    await selfProcedureAddTool.execute(
      fakeInvocation({
        name: 'second-rule',
        description: 'Second rule of fight club.',
        body: 'When: tempted to talk\nThen: still do not talk about it',
      }),
    );

    const listed = (await selfProcedureListTool.execute(
      fakeInvocation({}),
    )) as { procedures: { name: string; description: string }[] };
    expect(listed.procedures.length).toBe(2);
    expect(listed.procedures.map((p) => p.name).sort()).toEqual(['first-rule', 'second-rule']);
    expect(listed.procedures.every((p) => typeof p.description === 'string')).toBe(true);
    expect(listed.procedures[0]).not.toHaveProperty('body');

    const viewed = (await selfProcedureViewTool.execute(
      fakeInvocation({ name: 'first-rule' }),
    )) as { ok: boolean; body: string };
    expect(viewed.ok).toBe(true);
    expect(viewed.body).toContain('do not talk about fight club');
  });

  it('view returns a useful error when the name is unknown', async () => {
    await selfProcedureAddTool.execute(
      fakeInvocation({
        name: 'exists',
        description: 'A real procedure.',
        body: 'When: anything\nThen: exist',
      }),
    );
    const viewed = (await selfProcedureViewTool.execute(
      fakeInvocation({ name: 'does-not-exist' }),
    )) as { ok: boolean; reason?: string; available?: string[] };
    expect(viewed.ok).toBe(false);
    expect(viewed.available).toEqual(['exists']);
  });
});

describe('self.procedure.remove', () => {
  it('removes by name and drops the file from disk', async () => {
    const added = (await selfProcedureAddTool.execute(
      fakeInvocation({
        name: 'temporary',
        description: 'A procedure that gets removed.',
        body: 'When: this test runs\nThen: remove me',
      }),
    )) as { path: string };
    expect(existsSync(added.path)).toBe(true);
    const result = (await selfProcedureRemoveTool.execute(
      fakeInvocation({ name: 'temporary' }),
    )) as { ok: boolean; removed?: string; count: number };
    expect(result.ok).toBe(true);
    expect(result.removed).toBe('temporary');
    expect(result.count).toBe(0);
    expect(existsSync(added.path)).toBe(false);
  });

  it('returns a clean error for a missing name', async () => {
    const result = (await selfProcedureRemoveTool.execute(
      fakeInvocation({ name: 'never-existed' }),
    )) as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('not found');
  });
});

describe('loadProceduresForSystemPrompt + loadProceduresFile (back-compat)', () => {
  it('returns undefined when no procedures exist', async () => {
    const text = await loadProceduresForSystemPrompt(workspaceRoot, memberId);
    expect(text).toBeUndefined();
  });

  it('emits one name+description line per procedure for the system prompt', async () => {
    await selfProcedureAddTool.execute(
      fakeInvocation({
        name: 'use-bullets',
        description: 'When status reports run long, switch to bullets.',
        body: 'When: status report > 5 lines\nThen: switch to bullets',
      }),
    );
    const text = await loadProceduresForSystemPrompt(workspaceRoot, memberId);
    expect(text).toContain('use-bullets:');
    expect(text).toContain('switch to bullets');
    // Body is NOT in the prompt index — agent must call view().
    expect(text).not.toContain('Then: switch');
  });

  it('legacy `loadProceduresFile` shim still returns entries from new layout', async () => {
    await selfProcedureAddTool.execute(
      fakeInvocation({
        name: 'legacy-shim',
        description: 'Surfaces through the back-compat shim.',
        body: 'When: caller uses old shim\nThen: synthesise when/then',
      }),
    );
    const loaded = await loadProceduresFile(workspaceRoot, memberId);
    expect(loaded?.entries.length).toBe(1);
    expect(loaded?.entries[0]?.when).toContain('caller uses old shim');
  });
});

describe('proceduresDirPath sanitises member ids', () => {
  it('replaces unsafe characters and avoids path traversal', () => {
    const p = proceduresDirPath('/tmp/workspace', '../etc/passwd');
    expect(p).toContain('etc-passwd');
    expect(p).not.toContain('..');
  });
});

describe('listProcedures', () => {
  it('returns an empty array on a fresh workspace', async () => {
    const list = await listProcedures(workspaceRoot, memberId);
    expect(list).toEqual([]);
  });

  it('keeps the newest procedures when the directory exceeds the prompt cap', async () => {
    const dir = proceduresDirPath(workspaceRoot, memberId);
    await mkdir(dir, { recursive: true });
    const writeProcedure = async (name: string, createdAt: string) => {
      await writeFile(
        join(dir, `${name}.md`),
        [
          '---',
          `name: ${name}`,
          `description: ${name} description`,
          `created_at: ${createdAt}`,
          '---',
          '',
          `When: ${name}`,
          'Then: keep deterministic prompt coverage',
          '',
        ].join('\n'),
        'utf8',
      );
    };

    for (let i = 0; i < 50; i += 1) {
      await writeProcedure(
        `old-${String(i).padStart(2, '0')}`,
        `2025-01-01T00:00:${String(i).padStart(2, '0')}Z`,
      );
    }
    for (let i = 0; i < 5; i += 1) {
      await writeProcedure(
        `new-${String(i).padStart(2, '0')}`,
        `2026-01-01T00:00:0${i}Z`,
      );
    }

    const list = await listProcedures(workspaceRoot, memberId);
    const names = list.map((p) => p.name);

    expect(list).toHaveLength(50);
    expect(names.slice(0, 5)).toEqual(['new-04', 'new-03', 'new-02', 'new-01', 'new-00']);
    expect(names).toEqual(expect.arrayContaining(['old-05', 'old-49']));
    expect(names).not.toEqual(
      expect.arrayContaining(['old-00', 'old-01', 'old-02', 'old-03', 'old-04']),
    );
  });
});
