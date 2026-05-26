import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grepTool } from './grep.js';

describe('grep tool', () => {
  let root = '';

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = '';
    }
  });

  it('finds matching lines under a workspace path', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-grep-'));
    await writeFile(join(root, 'a.ts'), 'const cors = true;\n', 'utf8');
    await writeFile(join(root, 'b.ts'), 'CORS_CONFIG\n', 'utf8');
    await writeFile(join(root, 'nested.txt'), 'nothing here\n', 'utf8');

    const result = (await grepTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'grep',
        action: 'read',
        resourceType: 'folder',
        resourcePath: '.',
        input: { query: 'cors', limit: 20, ignoreCase: true },
      } as never,
      team: { workspace: { root } } as never,
      repo: {} as never,
      conversations: {} as never,
    })) as {
      query: string;
      path: string;
      count: number;
      truncated: boolean;
      contextLines: number;
      matches: { path: string; lineNumber: number; line: string; before: unknown[]; after: unknown[] }[];
    };

    expect(result.query).toBe('cors');
    expect(result.contextLines).toBe(2);
    expect(result.count).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.matches[0]).toMatchObject({
      path: expect.stringContaining('/a.ts'),
      lineNumber: 1,
      line: 'const cors = true;',
    });
    expect(result.matches[1]).toMatchObject({
      path: expect.stringContaining('/b.ts'),
      lineNumber: 1,
      line: 'CORS_CONFIG',
    });
  });

  it('returns surrounding context and supports higher result caps', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-grep-'));
    await writeFile(join(root, 'a.ts'), 'one\nbefore\nneedle\nbetween\nneedle\nend\n', 'utf8');

    const result = (await grepTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'grep',
        action: 'read',
        resourceType: 'folder',
        resourcePath: '.',
        input: { query: 'needle', limit: 200, context_lines: 1 },
      } as never,
      team: { workspace: { root } } as never,
      repo: {} as never,
      conversations: {} as never,
    })) as {
      limit: number;
      contextLines: number;
      matches: { before: { lineNumber: number; line: string }[]; after: { lineNumber: number; line: string }[] }[];
    };

    expect(result.limit).toBe(200);
    expect(result.contextLines).toBe(1);
    expect(result.matches.at(0)?.before).toEqual([{ lineNumber: 2, line: 'before' }]);
    expect(result.matches.at(0)?.after).toEqual([{ lineNumber: 4, line: 'between' }]);
  });

  it('skips hidden and secret-looking files without git', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-grep-'));
    await writeFile(join(root, 'app.ts'), 'const cors = true;\n', 'utf8');
    await writeFile(join(root, '.env'), 'CORS=true\n', 'utf8');
    await writeFile(join(root, '.npmrc'), 'cors=true\n', 'utf8');
    await writeFile(join(root, '.ssh'), 'not a directory\n', 'utf8');

    const result = (await grepTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'grep',
        action: 'read',
        resourceType: 'folder',
        resourcePath: '.',
        input: { query: 'cors', limit: 20, ignoreCase: true },
      } as never,
      team: { workspace: { root } } as never,
      repo: {} as never,
      conversations: {} as never,
    })) as {
      count: number;
      matches: { path: string; lineNumber: number; line: string }[];
    };

    expect(result.count).toBe(1);
    expect(result.matches[0]).toMatchObject({
      path: expect.stringContaining('/app.ts'),
      lineNumber: 1,
      line: 'const cors = true;',
    });
  });
});
