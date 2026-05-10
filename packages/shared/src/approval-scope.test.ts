import { describe, expect, it } from 'vitest';
import {
  formatApprovalRelayMarkdown,
  parseApprovalDisplayScopesFromReason,
  parseFilesystemScope,
  shellInvocationDisplayLine,
} from './approval-scope';

describe('formatApprovalRelayMarkdown', () => {
  it('renders cwd and shell line for shell scope', () => {
    const scope = 'shell:{"cwd":"/workspace","command":"git","args":["diff"]}';
    expect(
      formatApprovalRelayMarkdown({
        action: 'execute',
        resourcePath: '/workspace',
        reason: `Tool action requires approval;scope=${encodeURIComponent(scope)}`,
      }),
    ).toBe('```\n/workspace\n$ git diff\n```');
  });

  it('renders path and action for filesystem compact scope', () => {
    expect(
      formatApprovalRelayMarkdown({
        action: 'write',
        resourcePath: '/repo/readme.md',
        reason: 'Tool action requires approval;scope=filesystem%3Awrite%3A%2Frepo%2Freadme.md',
      }),
    ).toBe('```\n/repo/readme.md\nwrite\n```');
  });

  it('renders filesystem write with body when JSON scope includes patch', () => {
    const scope = JSON.stringify({ action: 'write', resourcePath: '/x/a.md', patch: '--- /dev/null\n+++ b/a.md\n' });
    expect(
      formatApprovalRelayMarkdown({
        action: 'write',
        resourcePath: '/x/a.md',
        reason: `Tool action requires approval;scope=${encodeURIComponent('filesystem:' + scope)}`,
      }),
    ).toBe('```\n/x/a.md\nwrite\n--- /dev/null\n+++ b/a.md\n\n```');
  });

  it('renders filesystem write with body when JSON scope includes content', () => {
    const scope = JSON.stringify({ action: 'write', resourcePath: '/x/a.md', content: 'hello' });
    expect(
      formatApprovalRelayMarkdown({
        action: 'write',
        resourcePath: '/x/a.md',
        reason: `Tool action requires approval;scope=${encodeURIComponent('filesystem:' + scope)}`,
      }),
    ).toBe('```\n/x/a.md\nwrite\nhello\n```');
  });

  it('falls back to action and path when scope is not shell or filesystem', () => {
    expect(
      formatApprovalRelayMarkdown({
        action: 'message',
        resourcePath: 'dm:abc',
        reason: 'Tool action requires approval;scope=other%3Athing',
      }),
    ).toBe('`message` · `dm:abc`');
  });
});

describe('parseApprovalDisplayScopesFromReason', () => {
  it('returns shell only for shell scope', () => {
    const scope = 'shell:{"cwd":"/w","command":"ls"}';
    const reason = `Tool action requires approval;scope=${encodeURIComponent(scope)}`;
    expect(parseApprovalDisplayScopesFromReason(reason)).toEqual({
      shell: { cwd: '/w', command: 'ls' },
      filesystem: null,
    });
  });

  it('returns filesystem only when scope is filesystem', () => {
    const reason =
      'Tool action requires approval;scope=filesystem%3Aread%3A%2Ftmp%2Fa.txt';
    expect(parseApprovalDisplayScopesFromReason(reason)).toEqual({
      shell: null,
      filesystem: { action: 'read', resourcePath: '/tmp/a.txt' },
    });
  });

  it('returns both null when scope missing', () => {
    expect(parseApprovalDisplayScopesFromReason('no scope here')).toEqual({
      shell: null,
      filesystem: null,
    });
  });
});

describe('parseFilesystemScope', () => {
  it('parses compact read scope', () => {
    expect(parseFilesystemScope('filesystem:read:/tmp/a.txt')).toEqual({
      action: 'read',
      resourcePath: '/tmp/a.txt',
    });
  });

  it('parses JSON scope with optional patch', () => {
    const inner = { action: 'write' as const, resourcePath: '/r.md', patch: '@@ -0,0 +1,1 @@\n+hi' };
    expect(parseFilesystemScope('filesystem:' + JSON.stringify(inner))).toEqual({
      action: 'write',
      resourcePath: '/r.md',
      patch: '@@ -0,0 +1,1 @@\n+hi',
    });
  });

  it('parses JSON scope with optional content', () => {
    expect(
      parseFilesystemScope('filesystem:{"action":"write","resourcePath":"/r.md","content":"x"}'),
    ).toEqual({ action: 'write', resourcePath: '/r.md', content: 'x' });
  });
});

describe('shellInvocationDisplayLine', () => {
  it('joins command and args', () => {
    expect(
      shellInvocationDisplayLine({ cwd: '/tmp', command: 'sh', args: ['-c', 'echo hi'] }),
    ).toBe('sh -c echo hi');
  });
});
