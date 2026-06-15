import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBinaryPath, RG_BINARY } from './binary-resolver.js';
import { grepTool } from './grep.js';

function rgAvailable(): boolean {
  try {
    resolveBinaryPath(RG_BINARY, 'RG_BIN_PATH');
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!rgAvailable())('grep (ripgrep)', () => {
  let root = '';

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = '';
    }
  });

  it('finds a literal string match', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-grep-'));
    await writeFile(join(root, 'a.ts'), 'const x = 42;\nconst y = 99;\n', 'utf8');

    const result = await grepTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'grep',
        action: 'read',
        resourceType: 'folder',
        resourcePath: '.',
        input: { query: '42' },
      },
      team: {
        workspace: { root },
        members: [{ id: 'agent-1', name: 'Agent', roles: [] }],
      },
    });

    expect(result.count).toBe(1);
    expect(result.matches[0].line).toBe('const x = 42;');
    expect(result.matches[0].lineNumber).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('supports regex patterns', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-grep-'));
    await writeFile(join(root, 'a.ts'), 'abc123\ndef456\nxyz789\n', 'utf8');

    const result = await grepTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-5',
        memberId: 'agent-1',
        toolCallId: 'call-5',
        toolId: 'grep',
        action: 'read',
        resourceType: 'folder',
        resourcePath: '.',
        input: { query: '\\d{3}' },
      },
      team: {
        workspace: { root },
        members: [{ id: 'agent-1', name: 'Agent', roles: [] }],
      },
    });

    expect(result.count).toBe(3);
  });

  it('limits results', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-grep-'));
    await writeFile(
      join(root, 'a.ts'),
      'match\nmatch\nmatch\nmatch\nmatch\nmatch\n',
      'utf8',
    );

    const result = await grepTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-8',
        memberId: 'agent-1',
        toolCallId: 'call-8',
        toolId: 'grep',
        action: 'read',
        resourceType: 'folder',
        resourcePath: '.',
        input: { query: 'match', limit: 3 },
      },
      team: {
        workspace: { root },
        members: [{ id: 'agent-1', name: 'Agent', roles: [] }],
      },
    });

    expect(result.count).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it('splits context correctly between adjacent matches', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-grep-'));
    await writeFile(
      join(root, 'a.ts'),
      'alpha\nbeta\ntarget1\ndelta\nepsilon\ntarget2\ngamma\n',
      'utf8',
    );

    const result = await grepTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-9',
        memberId: 'agent-1',
        toolCallId: 'call-9',
        toolId: 'grep',
        action: 'read',
        resourceType: 'folder',
        resourcePath: '.',
        input: { query: 'target', contextLines: 2 },
      },
      team: {
        workspace: { root },
        members: [{ id: 'agent-1', name: 'Agent', roles: [] }],
      },
    });

    expect(result.count).toBe(2);

    // First match (line 3): before=[line1, line2], after=[line4, line5]
    expect(result.matches[0].lineNumber).toBe(3);
    expect(result.matches[0].before).toHaveLength(2);
    expect(result.matches[0].before[0].line).toBe('alpha');
    expect(result.matches[0].before[1].line).toBe('beta');
    // Overlapping context: lines 4-5 are after match 1 AND before match 2
    expect(result.matches[0].after).toHaveLength(2);
    expect(result.matches[0].after[0].line).toBe('delta');
    expect(result.matches[0].after[1].line).toBe('epsilon');

    // Second match (line 6): before=[line4, line5] (shared), after=[line7]
    expect(result.matches[1].lineNumber).toBe(6);
    expect(result.matches[1].before).toHaveLength(2);
    expect(result.matches[1].before[0].line).toBe('delta');
    expect(result.matches[1].before[1].line).toBe('epsilon');
    expect(result.matches[1].after).toHaveLength(1);
    expect(result.matches[1].after[0].line).toBe('gamma');
  });

});
