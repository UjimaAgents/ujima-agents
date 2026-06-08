import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grepTool, GrepSchema } from './grep.js';

describe('grep (ripgrep)', () => {
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

  it('returns empty for no match', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-grep-'));
    await writeFile(join(root, 'a.ts'), 'const x = 42;\n', 'utf8');

    const result = await grepTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-2',
        memberId: 'agent-1',
        toolCallId: 'call-2',
        toolId: 'grep',
        action: 'read',
        resourceType: 'folder',
        resourcePath: '.',
        input: { query: 'zzz_not_found' },
      },
      team: {
        workspace: { root },
        members: [{ id: 'agent-1', name: 'Agent', roles: [] }],
      },
    });

    expect(result.count).toBe(0);
    expect(result.matches).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('supports ignoreCase', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-grep-'));
    await writeFile(join(root, 'a.ts'), 'Hello World\nconst x = 42;\n', 'utf8');

    const result = await grepTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-3',
        memberId: 'agent-1',
        toolCallId: 'call-3',
        toolId: 'grep',
        action: 'read',
        resourceType: 'folder',
        resourcePath: '.',
        input: { query: 'hello', ignoreCase: true },
      },
      team: {
        workspace: { root },
        members: [{ id: 'agent-1', name: 'Agent', roles: [] }],
      },
    });

    expect(result.count).toBe(1);
    expect(result.matches[0].line).toBe('Hello World');
  });

  it('respects contextLines', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-grep-'));
    await writeFile(
      join(root, 'a.ts'),
      'line1\nline2\nline3\nTARGET\nline5\nline6\nline7\n',
      'utf8',
    );

    const result = await grepTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-4',
        memberId: 'agent-1',
        toolCallId: 'call-4',
        toolId: 'grep',
        action: 'read',
        resourceType: 'folder',
        resourcePath: '.',
        input: { query: 'TARGET', contextLines: 2 },
      },
      team: {
        workspace: { root },
        members: [{ id: 'agent-1', name: 'Agent', roles: [] }],
      },
    });

    expect(result.count).toBe(1);
    expect(result.matches[0].before).toHaveLength(2);
    expect(result.matches[0].after).toHaveLength(2);
    expect(result.matches[0].before[0].line).toBe('line2');
    expect(result.matches[0].before[1].line).toBe('line3');
    expect(result.matches[0].after[0].line).toBe('line5');
    expect(result.matches[0].after[1].line).toBe('line6');
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

  it('scopes search to subdirectory', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-grep-'));
    await mkdir(join(root, 'sub'), { recursive: true });
    await writeFile(join(root, 'root.txt'), 'target\n', 'utf8');
    await writeFile(join(root, 'sub', 'sub.txt'), 'target\n', 'utf8');

    const result = await grepTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-7',
        memberId: 'agent-1',
        toolCallId: 'call-7',
        toolId: 'grep',
        action: 'read',
        resourceType: 'folder',
        resourcePath: 'sub',
        input: { query: 'target' },
      },
      team: {
        workspace: { root },
        members: [{ id: 'agent-1', name: 'Agent', roles: [] }],
      },
    });

    expect(result.count).toBe(1);
    expect(result.matches[0].path).toContain('sub.txt');
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
