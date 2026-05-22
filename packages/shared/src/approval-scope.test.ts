import { describe, expect, it } from 'vitest';
import {
  approvalScopeMatches,
  approvalScopeMatchesPersisted,
  canonicalizeApprovalFamilyScope,
  canonicalizeApprovalGrantScope,
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
    ).toBe('[Approval needed] Shell\nCwd: /workspace\nCommand: git diff');
  });

  it('renders path and action for filesystem compact scope', () => {
    expect(
      formatApprovalRelayMarkdown({
        action: 'write',
        resourcePath: '/repo/readme.md',
        reason: 'Tool action requires approval;scope=filesystem%3Awrite%3A%2Frepo%2Freadme.md',
      }),
    ).toBe('[Approval needed] Filesystem write\nPath: /repo/readme.md');
  });

  it('renders filesystem write with body when JSON scope includes patch', () => {
    const scope = JSON.stringify({ action: 'write', resourcePath: '/x/a.md', patch: '--- /dev/null\n+++ b/a.md\n' });
    expect(
      formatApprovalRelayMarkdown({
        action: 'write',
        resourcePath: '/x/a.md',
        reason: `Tool action requires approval;scope=${encodeURIComponent('filesystem:' + scope)}`,
      }),
    ).toBe('[Approval needed] Filesystem write\nPath: /x/a.md\nPatch:\n--- /dev/null\n+++ b/a.md\n');
  });

  it('renders filesystem write with body when JSON scope includes content', () => {
    const scope = JSON.stringify({ action: 'write', resourcePath: '/x/a.md', content: 'hello' });
    expect(
      formatApprovalRelayMarkdown({
        action: 'write',
        resourcePath: '/x/a.md',
        reason: `Tool action requires approval;scope=${encodeURIComponent('filesystem:' + scope)}`,
      }),
    ).toBe('[Approval needed] Filesystem write\nPath: /x/a.md\nPatch:\nhello');
  });

  it('renders workspace write approval as a diff patch', () => {
    const scope = JSON.stringify({ resourcePath: '/x/a.md', content: 'hello\nworld' });
    expect(
      formatApprovalRelayMarkdown({
        action: 'write',
        resourcePath: '/x/a.md',
        reason: `Tool action requires approval;scope=${encodeURIComponent('write:' + scope)}`,
      }),
    ).toBe(
      '[Approval needed] Filesystem write\nPath: /x/a.md\nPatch:\n--- /x/a.md\n+++ /x/a.md\n@@ -0,0 +1,2 @@\n+hello\n+world',
    );
  });

  it('renders workspace edit approval as a diff patch', () => {
    const scope = JSON.stringify({ file_path: '/x/a.md', old_string: 'old', new_string: 'new' });
    expect(
      formatApprovalRelayMarkdown({
        action: 'edit',
        resourcePath: '/x/a.md',
        reason: `Tool action requires approval;scope=${encodeURIComponent('edit:' + scope)}`,
      }),
    ).toBe('[Approval needed] Filesystem write\nPath: /x/a.md\nPatch:\n--- /x/a.md\n+++ /x/a.md\n@@\n-old\n+new');
  });

  it('renders workspace multiedit approval as a diff patch', () => {
    const scope = JSON.stringify({
      resourcePath: '/x/a.md',
      edits: [
        { oldString: 'one', newString: 'two' },
        { old_string: 'red', new_string: 'blue' },
      ],
    });
    expect(
      formatApprovalRelayMarkdown({
        action: 'multiedit',
        resourcePath: '/x/a.md',
        reason: `Tool action requires approval;scope=${encodeURIComponent('multiedit:' + scope)}`,
      }),
    ).toBe(
      '[Approval needed] Filesystem write\nPath: /x/a.md\nPatch:\n--- /x/a.md\n+++ /x/a.md\n@@\n-one\n+two\n--- /x/a.md\n+++ /x/a.md\n@@\n-red\n+blue',
    );
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

describe('approvalScopeMatches', () => {
  it('matches legacy shell scopes to canonical JSON at grant precision', () => {
    const legacy = 'shell:/workspace:git:["status"]';
    const status = 'shell:{"cwd":"/workspace","command":"git","args":["status"]}';
    const log = 'shell:{"cwd":"/workspace","command":"git","args":["log"]}';
    expect(approvalScopeMatches(legacy, status)).toBe(true);
    expect(approvalScopeMatches(legacy, log)).toBe(false);
  });

  it('does not treat different shell args as family-equivalent in grant mode', () => {
    const status = 'shell:{"cwd":"/workspace","command":"git","args":["status"]}';
    const log = 'shell:{"cwd":"/workspace","command":"git","args":["log"]}';
    expect(canonicalizeApprovalFamilyScope(status)).toBe(canonicalizeApprovalFamilyScope(log));
    expect(approvalScopeMatches(status, log)).toBe(false);
    expect(
      approvalScopeMatchesPersisted(status, canonicalizeApprovalFamilyScope(log), 'family'),
    ).toBe(true);
    expect(approvalScopeMatchesPersisted(status, canonicalizeApprovalGrantScope(log), 'grant')).toBe(
      false,
    );
  });
});
