import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lsTool } from './ls.js';

describe('ls', () => {
  let root = '';

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = '';
    }
  });

  it('lists directory entries as a tree', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-ls-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    await writeFile(join(root, 'README.md'), '# demo\n', 'utf8');

    const result = await lsTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'ls',
        action: 'read',
        resourceType: 'folder',
        resourcePath: '.',
        input: { depth: 2 },
      },
      team: {
        workspace: { root },
        members: [{ id: 'agent-1', name: 'Agent', roles: [] }],
      },
    });

    expect(result.count).toBeGreaterThanOrEqual(2);
    expect(result.content).toContain('src/');
    expect(result.content).toContain('README.md');
  });
});
