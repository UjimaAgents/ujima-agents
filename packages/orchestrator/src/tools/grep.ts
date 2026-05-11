import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { assertWorkspaceBoundary } from '@ujima/shared/workspace';
import { isSensitiveWorkspacePath } from '@ujima/shared/workspace-file-filters';
import type { OrchestratorTool } from './types.js';
import { readWindowValue } from './window-utils.js';

const DEFAULT_LIMIT = 20;
const IGNORED_DIRECTORIES = new Set(['.git', '.next', 'build', 'coverage', 'dist', 'node_modules']);

export const GrepSchema = z.object({
  query: z.string().min(1),
  path: z.string().min(1).default('.'),
  limit: z.number().int().min(1).max(100).default(DEFAULT_LIMIT),
  ignoreCase: z.boolean().default(false),
});

export interface GrepMatch {
  path: string;
  lineNumber: number;
  line: string;
}

export const grepTool: OrchestratorTool<typeof GrepSchema> = {
  id: 'grep',
  schema: GrepSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'folder',
    resourcePath: args.path,
    input: args,
  }),
  execute: async ({ invocation, team }) => {
    const query = String(invocation.input.query).trim();
    const resourcePath = invocation.resourcePath ?? String(invocation.input.path ?? '.');
    const ignoreCase = invocation.input.ignoreCase === true;
    const limit = readWindowValue(invocation.input.limit, DEFAULT_LIMIT);
    const resolved = assertWorkspaceBoundary(team.workspace.root, resourcePath);
    const matches: GrepMatch[] = [];
    const needle = ignoreCase ? query.toLowerCase() : query;
    const resourceInfo = await stat(resolved);

    if (resourceInfo.isDirectory()) {
      for (const filePath of await collectSearchableFiles(team.workspace.root, resolved)) {
        await searchFile(filePath);
        if (matches.length >= limit) break;
      }
    } else if (await isSearchableFile(team.workspace.root, resolved)) {
      await searchFile(resolved);
    }

    return {
      query,
      path: resolved,
      limit,
      ignoreCase,
      truncated: matches.length >= limit,
      count: matches.length,
      matches,
    };

    async function searchFile(path: string): Promise<void> {
      if (matches.length >= limit) return;
      const text = await readFile(path, 'utf8').catch(() => null);
      if (typeof text !== 'string') return;
      const haystack = ignoreCase ? needle : query;
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        if (matches.length >= limit) return;
        const line = lines[index] ?? '';
        const candidate = ignoreCase ? line.toLowerCase() : line;
        if (!candidate.includes(haystack)) continue;
        matches.push({
          path,
          lineNumber: index + 1,
          line,
        });
      }
    }
  },
};

async function collectSearchableFiles(workspaceRoot: string, resolvedPath: string): Promise<string[]> {
  const gitFiles = listGitFiles(workspaceRoot, resolvedPath);
  if (gitFiles) {
    return gitFiles.filter((filePath) => !isSensitiveWorkspacePath(filePath));
  }

  const files: string[] = [];
  await walkPath(resolvedPath);
  return files;

  async function walkPath(path: string): Promise<void> {
    const info = await stat(path);
    if (info.isDirectory()) {
      const entries = await readdir(path, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
        if (entry.isDirectory() && entry.name.startsWith('.')) continue;
        const entryPath = join(path, entry.name);
        if (isSensitiveWorkspacePath(entryPath)) continue;
        await walkPath(entryPath);
      }
      return;
    }

    if (isSensitiveWorkspacePath(path)) return;
    files.push(path);
  }
}

async function isSearchableFile(workspaceRoot: string, filePath: string): Promise<boolean> {
  if (isSensitiveWorkspacePath(filePath)) return false;
  const gitIgnored = checkGitIgnored(workspaceRoot, filePath);
  if (gitIgnored !== null) return !gitIgnored;
  return true;
}

function listGitFiles(workspaceRoot: string, resolvedPath: string): string[] | null {
  try {
    const relativePath = relative(workspaceRoot, resolvedPath) || '.';
    const output = execFileSync(
      'git',
      ['-C', workspaceRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--full-name', '--', relativePath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return output
      .split('\0')
      .filter(Boolean)
      .map((path) => join(workspaceRoot, path));
  } catch {
    return null;
  }
}

function checkGitIgnored(workspaceRoot: string, filePath: string): boolean | null {
  try {
    const relativePath = relative(workspaceRoot, filePath) || '.';
    execFileSync('git', ['-C', workspaceRoot, 'check-ignore', '--quiet', '--', relativePath], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return null;
  }
}
