import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filesystemTool } from './filesystem.js';

describe('filesystem tool', () => {
  let root = '';

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = '';
    }
  });

  it('reads soul.md when it exists', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-fs-'));
    await writeFile(join(root, 'soul.md'), 'This is the soul.', 'utf8');

    const result = (await filesystemTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'filesystem',
        action: 'read',
        resourceType: 'file',
        resourcePath: 'soul.md',
        input: {},
      } as never,
      team: { workspace: { root } } as never,
      repo: {} as never,
      conversations: {} as never,
    })) as { type: string; path: string; content: string };

    expect(result).toMatchObject({
      type: 'file',
      content: 'This is the soul.',
    });
    expect(result.path.endsWith('soul.md')).toBe(true);
  });

  it('throws ENOENT when soul.md does not exist', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-fs-'));

    await expect(
      filesystemTool.execute({
        invocation: {
          organizationId: 'org-1',
          runId: 'run-1',
          memberId: 'agent-1',
          toolCallId: 'call-1',
          toolId: 'filesystem',
          action: 'read',
          resourceType: 'file',
          resourcePath: 'soul.md',
          input: {},
        } as never,
        team: { workspace: { root } } as never,
        repo: {} as never,
        conversations: {} as never,
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
