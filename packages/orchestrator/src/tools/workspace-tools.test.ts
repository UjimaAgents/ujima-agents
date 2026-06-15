import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editTool, writeTool } from './workspace-tools.js';

describe('workspace edit tools', () => {
  let root = '';

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = '';
    }
  });

  it('can anchor duplicate edits with start_line', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-edit-'));
    const file = join(root, 'a.ts');
    await writeFile(file, 'const value = 1;\nconst value = 1;\n', 'utf8');

    await editTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'edit',
        action: 'write',
        resourceType: 'file',
        resourcePath: 'a.ts',
        input: { oldString: 'const value = 1;', newString: 'const value = 2;', startLine: 2 },
      } as never,
      team: { workspace: { root } } as never,
      repo: {} as never,
      conversations: {} as never,
    });

    expect(await readFile(file, 'utf8')).toBe('const value = 1;\nconst value = 2;\n');
  });

  it('does not index sensitive workspace writes for recall', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-edit-'));
    let indexedPath: string | undefined;
    let deletedPath: string | undefined;

    await writeTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'write',
        action: 'write',
        resourceType: 'file',
        resourcePath: '.env',
        input: { content: 'SECRET_TOKEN=needle-secret' },
      } as never,
      team: { workspace: { root } } as never,
      repo: {
        upsertWorkspaceFile: (input: { path: string }) => {
          indexedPath = input.path;
          return input;
        },
        deleteWorkspaceFile: (_organizationId: string, path: string) => {
          deletedPath = path;
          return true;
        },
      } as never,
      conversations: {} as never,
    });

    expect(await readFile(join(root, '.env'), 'utf8')).toBe('SECRET_TOKEN=needle-secret');
    expect(indexedPath).toBeUndefined();
    expect(deletedPath).toBe('.env');
  });

  // Procedures-as-Culture (docs/procedures-as-culture.md "Security boundary").
  it('rejects agent writes to org culture', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-edit-'));
    await expect(
      writeTool.execute({
        invocation: {
          organizationId: 'org-1',
          runId: 'run-1',
          memberId: 'agent-layla',
          toolCallId: 'call-1',
          toolId: 'write',
          action: 'write',
          resourceType: 'file',
          resourcePath: 'ai/memory-bank/org/procedures/take-over-org.md',
          input: { content: 'oops' },
        } as never,
        team: { workspace: { root } } as never,
        repo: {} as never,
        conversations: {} as never,
      }),
    ).rejects.toThrow(/agents may only write under ai\/memory-bank\/agents\/<self>/);
  });

  it('allows agent writes inside its OWN subtree', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-edit-'));
    const result = await writeTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-layla',
        toolCallId: 'call-1',
        toolId: 'write',
        action: 'write',
        resourceType: 'file',
        resourcePath: 'ai/memory-bank/agents/agent-layla/notes/observation.md',
        input: { content: 'my own note' },
      } as never,
      team: { workspace: { root } } as never,
      repo: {} as never,
      conversations: {} as never,
    });
    expect((result as { success: boolean }).success).toBe(true);
  });

});
