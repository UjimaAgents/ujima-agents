import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filesystemTool } from './filesystem.js';

const newFilePatch = `--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+alpha
+beta
`;

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

  it('write creates a new file from a unified diff against empty content', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-fs-'));
    const target = join(root, 'new.txt');

    await filesystemTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'filesystem',
        action: 'write',
        resourceType: 'file',
        resourcePath: 'new.txt',
        input: { patch: newFilePatch },
      } as never,
      team: { workspace: { root } } as never,
      repo: {} as never,
      conversations: {} as never,
    });

    expect(await readFile(target, 'utf8')).toBe('alpha\nbeta\n');
  });

  it('write applies a unified diff to an existing file', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-fs-'));
    await writeFile(join(root, 'edit.md'), 'keep\nold line\nend\n', 'utf8');

    const patch = `--- a/edit.md
+++ b/edit.md
@@ -1,3 +1,3 @@
 keep
-old line
+new line
 end
`;

    await filesystemTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'filesystem',
        action: 'write',
        resourceType: 'file',
        resourcePath: 'edit.md',
        input: { patch },
      } as never,
      team: { workspace: { root } } as never,
      repo: {} as never,
      conversations: {} as never,
    });

    expect(await readFile(join(root, 'edit.md'), 'utf8')).toBe('keep\nnew line\nend\n');
  });

  it('write preserves trailing blank context lines in patches', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-fs-'));
    await writeFile(
      join(root, 'quick.md'),
      'hello\n# TimetoTest Backend - Quick Reference Guide\n# TimetoTest Backend - Quick Reference Guide\n\n',
      'utf8',
    );

    const patch = `--- a/quick.md
+++ b/quick.md
@@ -1,4 +1,3 @@
-hello
 # TimetoTest Backend - Quick Reference Guide
 # TimetoTest Backend - Quick Reference Guide
 
`;

    await filesystemTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'filesystem',
        action: 'write',
        resourceType: 'file',
        resourcePath: 'quick.md',
        input: { patch },
      } as never,
      team: { workspace: { root } } as never,
      repo: {} as never,
      conversations: {} as never,
    });

    expect(await readFile(join(root, 'quick.md'), 'utf8')).toBe(
      '# TimetoTest Backend - Quick Reference Guide\n# TimetoTest Backend - Quick Reference Guide\n\n',
    );
  });

  it('write rejects a patch that does not match the file', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-fs-'));
    await writeFile(join(root, 'x.md'), 'wrong\n', 'utf8');

    const patch = `--- a/x.md
+++ b/x.md
@@ -1,1 +1,1 @@
-not in file
+replaced
`;

    await expect(
      filesystemTool.execute({
        invocation: {
          organizationId: 'org-1',
          runId: 'run-1',
          memberId: 'agent-1',
          toolCallId: 'call-1',
          toolId: 'filesystem',
          action: 'write',
          resourceType: 'file',
          resourcePath: 'x.md',
          input: { patch },
        } as never,
        team: { workspace: { root } } as never,
        repo: {} as never,
        conversations: {} as never,
      }),
    ).rejects.toThrow(/Patch did not apply/);
  });
});
