import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listProcedures,
  loadProceduresForSystemPrompt,
  proceduresDirPath,
  selfProcedureAddTool,
  selfProcedureRemoveTool,
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

});

describe('loadProceduresForSystemPrompt', () => {
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
});

describe('listProcedures', () => {
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
