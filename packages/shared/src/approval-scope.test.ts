import { describe, expect, it } from 'vitest';
import { formatApprovalRelayMarkdown, shellInvocationDisplayLine } from './approval-scope';

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

  it('falls back to action and path when scope is not shell', () => {
    expect(
      formatApprovalRelayMarkdown({
        action: 'write',
        resourcePath: '/repo/readme.md',
        reason: 'Tool action requires approval;scope=filesystem%3Awrite%3A%2Frepo%2Freadme.md',
      }),
    ).toBe('`write` · `/repo/readme.md`');
  });
});

describe('shellInvocationDisplayLine', () => {
  it('joins command and args', () => {
    expect(
      shellInvocationDisplayLine({ cwd: '/tmp', command: 'sh', args: ['-c', 'echo hi'] }),
    ).toBe('sh -c echo hi');
  });
});
