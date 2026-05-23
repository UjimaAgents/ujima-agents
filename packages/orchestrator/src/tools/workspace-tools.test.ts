import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editTool, multieditTool } from './workspace-tools.js';

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

  it('supports explicit whitespace matching for formatting drift', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-edit-'));
    const file = join(root, 'a.ts');
    await writeFile(file, 'function run() {\n  return 1;\n}\n', 'utf8');

    await multieditTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'multiedit',
        action: 'write',
        resourceType: 'file',
        resourcePath: 'a.ts',
        input: {
          edits: [
            {
              oldString: 'function run() { return 1; }',
              newString: 'function run() {\n  return 2;\n}',
              matchStrategy: 'whitespace',
            },
          ],
        },
      } as never,
      team: { workspace: { root } } as never,
      repo: {} as never,
      conversations: {} as never,
    });

    expect(await readFile(file, 'utf8')).toBe('function run() {\n  return 2;\n}\n');
  });

  it('rejects whitespace-only match targets', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-edit-'));
    const file = join(root, 'a.ts');
    await writeFile(file, 'const value = 1;\n', 'utf8');

    await expect(
      editTool.execute({
        invocation: {
          organizationId: 'org-1',
          runId: 'run-1',
          memberId: 'agent-1',
          toolCallId: 'call-1',
          toolId: 'edit',
          action: 'write',
          resourceType: 'file',
          resourcePath: 'a.ts',
          input: { oldString: '   \n', newString: 'x', matchStrategy: 'whitespace' },
        } as never,
        team: { workspace: { root } } as never,
        repo: {} as never,
        conversations: {} as never,
      }),
    ).rejects.toThrow('match_strategy="whitespace" requires at least one non-whitespace character in oldString');
  });
});
