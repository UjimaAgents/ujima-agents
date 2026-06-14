import { basename, join, relative, sep } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { z } from 'zod';
import { assertWorkspaceBoundary } from '@ujima/shared/workspace';
import { isSensitiveWorkspacePath, shouldSkipWorkspaceTreeDirectory } from '@ujima/shared/workspace-file-filters';
import type { OrchestratorTool } from './types.js';
import { readWindowValue } from './window-utils.js';

const TREE_LIMIT = 1000;

const LsSchema = z.object({
  path: z.string().min(1).default('.'),
  ignore: z.array(z.string().min(1)).default([]),
  depth: z.number().int().min(0).max(20).default(0),
  limit: z.number().int().min(1).max(TREE_LIMIT).default(TREE_LIMIT),
});

interface TreeEntry {
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
}

export const lsTool: OrchestratorTool<typeof LsSchema> = {
  id: 'ls',
  schema: LsSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'folder',
    resourcePath: args.path,
    input: {
      ignore: args.ignore,
      depth: args.depth,
      limit: args.limit,
    },
  }),
  execute: async ({ invocation, team }) => {
    const resourcePath = typeof invocation.resourcePath === 'string' ? invocation.resourcePath : '.';
    const resolved = assertWorkspaceBoundary(team.workspace.root, resourcePath);
    const resource = await stat(resolved);
    const limit = readWindowValue(invocation.input?.limit, TREE_LIMIT);
    const depth = readWindowValue(invocation.input?.depth, 0);
    const ignore = Array.isArray(invocation.input?.ignore)
      ? invocation.input.ignore.map((entry) => String(entry))
      : [];
    const entries: TreeEntry[] = [];

    if (resource.isDirectory()) {
      await collectTreeEntries({
        root: resolved,
        current: resolved,
        currentDepth: 0,
        maxDepth: depth,
        ignore,
        entries,
        limit,
      });
    } else {
      entries.push({
        path: resolved,
        name: basename(resolved),
        isDir: false,
        depth: 0,
      });
    }

    const content = formatTreeOutput(resourcePath, entries, limit);
    return {
      path: resolved,
      content,
      count: entries.length,
      truncated: entries.length >= limit,
    };
  },
};

async function collectTreeEntries(input: {
  root: string;
  current: string;
  currentDepth: number;
  maxDepth: number;
  ignore: string[];
  entries: TreeEntry[];
  limit: number;
}): Promise<void> {
  if (input.entries.length >= input.limit) return;

  const dirents = await readdir(input.current, { withFileTypes: true });
  dirents.sort((a, b) => a.name.localeCompare(b.name));

  for (const dirent of dirents) {
    if (input.entries.length >= input.limit) return;
    if (dirent.name.startsWith('.')) continue;
    if (dirent.isDirectory() && shouldSkipWorkspaceTreeDirectory(dirent.name)) continue;

    const fullPath = join(input.current, dirent.name);
    if (isSensitiveWorkspacePath(fullPath)) continue;

    const rel = normalizePath(relative(input.root, fullPath) || dirent.name);
    if (input.ignore.some((pattern) => matchGlob(pattern, rel) || matchGlob(pattern, basename(rel)))) {
      continue;
    }

    const isDir = dirent.isDirectory();
    input.entries.push({
      path: fullPath,
      name: dirent.name,
      isDir,
      depth: input.currentDepth,
    });

    if (isDir && (input.maxDepth === 0 || input.currentDepth + 1 < input.maxDepth)) {
      await collectTreeEntries({
        ...input,
        current: fullPath,
        currentDepth: input.currentDepth + 1,
      });
    }
  }
}

function formatTreeOutput(rootLabel: string, entries: TreeEntry[], limit: number): string {
  const lines = [normalizePath(rootLabel || '.')];
  for (const entry of entries) {
    const prefix = '  '.repeat(entry.depth);
    lines.push(`${prefix}${entry.name}${entry.isDir ? '/' : ''}`);
  }
  if (entries.length >= limit) {
    lines.push('');
    lines.push(`(Truncated after ${limit} entries)`);
  }
  return lines.join('\n');
}

function matchGlob(pattern: string, candidate: string): boolean {
  const normalizedPattern = normalizePath(pattern.trim());
  const normalizedCandidate = normalizePath(candidate.trim());
  if (!normalizedPattern) return false;
  return globToRegExp(normalizedPattern).test(normalizedCandidate);
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] ?? '';
    if (char === '*') {
      const next = pattern[i + 1];
      if (next === '*') {
        const after = pattern[i + 2];
        if (after === '/') {
          source += '(?:.*/)?';
          i += 2;
          continue;
        }
        source += '.*';
        i += 1;
        continue;
      }
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeRegExp(char);
  }
  source += '$';
  return new RegExp(source);
}

function escapeRegExp(char: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

function normalizePath(path: string): string {
  return path.split(sep).join('/');
}
