import { describe, expect, it } from 'vitest';
import {
  parseFilesystemToolCallArgs,
  parseGrepToolCallArgs,
  parseShellToolCallArgs,
  parseWebSearchToolCallArgs,
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

  it('defaults cwd to dot when missing', () => {
    expect(parseShellToolCallArgs({ command: 'ls' })).toEqual({ cwd: '.', command: 'ls' });
  });

  it('returns null without command', () => {
    expect(parseShellToolCallArgs({ cwd: '/a' })).toBeNull();
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

  it('parses nested write with patch', () => {
    expect(
      parseFilesystemToolCallArgs({
        input: { action: 'write', resourcePath: '/a.md', patch: '--- a\n+++ b\n' },
      } as Record<string, unknown>),
    ).toEqual({ action: 'write', resourcePath: '/a.md', patch: '--- a\n+++ b\n' });
  });

  it('parses legacy nested write with content', () => {
    expect(
      parseFilesystemToolCallArgs({
        input: { action: 'write', resourcePath: '/a.md', content: 'body' },
      } as Record<string, unknown>),
    ).toEqual({ action: 'write', resourcePath: '/a.md', content: 'body' });
  });

  it('returns null for invalid action', () => {
    expect(
      parseFilesystemToolCallArgs({ action: 'delete', resourcePath: '/x' }),
    ).toBeNull();
  });
});

describe('parseGrepToolCallArgs', () => {
  it('parses flat args', () => {
    expect(
      parseGrepToolCallArgs({
        query: 'cors',
        resourcePath: 'apps/web',
        limit: 5,
        ignoreCase: true,
      }),
    ).toEqual({
      query: 'cors',
      resourcePath: 'apps/web',
      limit: 5,
      ignoreCase: true,
    });
  });

  it('parses nested input', () => {
    expect(
      parseGrepToolCallArgs({
        input: { query: 'auth', path: 'packages', limit: 3 },
      } as Record<string, unknown>),
    ).toEqual({ query: 'auth', resourcePath: 'packages', limit: 3 });
  });

  it('returns null without query', () => {
    expect(parseGrepToolCallArgs({ path: 'apps/web' })).toBeNull();
  });
});

describe('parseWebSearchToolCallArgs', () => {
  it('parses flat query and site', () => {
    expect(parseWebSearchToolCallArgs({ query: 'openai api', site: 'openai.com', limit: 3 })).toEqual({
      query: 'openai api',
      site: 'openai.com',
      limit: 3,
    });
  });

  it('parses nested input', () => {
    expect(
      parseWebSearchToolCallArgs({
        input: { query: 'web search', site: 'docs.example.com', limit: 5 },
      } as Record<string, unknown>),
    ).toEqual({ query: 'web search', site: 'docs.example.com', limit: 5 });
  });

  it('returns null without query', () => {
    expect(parseWebSearchToolCallArgs({ site: 'example.com' })).toBeNull();
  });
});
