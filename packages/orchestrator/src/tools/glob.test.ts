import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBinaryPath, FD_BINARY } from './binary-resolver.js';
import { globTool } from './glob.js';

function fdAvailable(): boolean {
  try {
    resolveBinaryPath(FD_BINARY, 'FD_BIN_PATH');
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!fdAvailable())('glob (fd)', () => {
  let root = '';

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = '';
    }
  });

  it('finds files matching a glob pattern', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-glob-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    await writeFile(join(root, 'src', 'b.js'), 'export const b = 1;\n', 'utf8');

    const result = await globTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'glob',
        action: 'read',
        resourceType: 'folder',
        resourcePath: '.',
        input: { pattern: '*.ts' },
      },
      team: {
        workspace: { root },
        members: [{ id: 'agent-1', name: 'Agent', roles: [] }],
      },
    });

    expect(result.count).toBe(1);
    expect(result.matches[0]).toContain('a.ts');
  });
});
