import { describe, expect, it } from 'vitest';
import {
  parseFilesystemToolCallArgs,
  parseShellToolCallArgs,
} from './tool-call-display-args';

describe('parseShellToolCallArgs', () => {
  it('reads flat command and cwd', () => {
    expect(parseShellToolCallArgs({ cwd: '/app', command: 'git', args: ['status'] })).toEqual({
      cwd: '/app',
      command: 'git',
      args: ['status'],
    });
  });

  it('reads nested input', () => {
    expect(
      parseShellToolCallArgs({
        input: { cwd: '/x', command: 'echo', args: ['hi'] },
      } as Record<string, unknown>),
    ).toEqual({ cwd: '/x', command: 'echo', args: ['hi'] });
  });

});

describe('parseFilesystemToolCallArgs', () => {
  it('parses flat read', () => {
    expect(
      parseFilesystemToolCallArgs({
        action: 'read',
        resourcePath: '/f.txt',
        offset: 10,
        limit: 20,
      }),
    ).toEqual({ action: 'read', resourcePath: '/f.txt', offset: 10, limit: 20 });
  });

  it('returns null for invalid action', () => {
    expect(
      parseFilesystemToolCallArgs({ action: 'delete', resourcePath: '/x' }),
    ).toBeNull();
  });
});

