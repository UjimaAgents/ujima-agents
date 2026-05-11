import { describe, expect, it } from 'vitest';
import { normalizeShellScope } from './shell-scope.js';

describe('normalizeShellScope', () => {
  it('scopes cd-and-run shell commands to the executed command', () => {
    expect(
      normalizeShellScope({
        input: {
          command: 'cd /workspace/app && git log --oneline -20',
        },
        resourcePath: '/workspace',
      }),
    ).toEqual({
      cwd: '/workspace/app',
      command: 'git',
      args: ['log', '--oneline', '-20'],
    });
  });
});
