import { basename, relative } from 'node:path';
import { z } from 'zod';
import { assertWorkspaceBoundary } from '@ujima/shared/workspace';
import { isSensitiveWorkspacePath } from '@ujima/shared/workspace-file-filters';
import { resolveBinaryPath, type BinaryDescriptor } from './binary-resolver.js';
import { runCli } from './cli-runner.js';
import type { OrchestratorTool } from './types.js';

const FD: BinaryDescriptor = { name: 'fd', dir: 'fd', filename: 'fd' };

const TREE_LIMIT = 1000;

const LsSchema = z.object({
  path: z.string().min(1).default('.'),
  ignore: z.array(z.string().min(1)).default([]),
  depth: z.number().int().min(0).max(20).default(0),
  limit: z.number().int().min(1).max(TREE_LIMIT).default(TREE_LIMIT),
});

// ── Types ──────────────────────────────────────────────────────────

interface TreeEntry {
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
}

interface FdJsonEntry {
  type: 'file' | 'directory' | 'symlink';
  name: string;
  path: string;
}

// ── Tool ───────────────────────────────────────────────────────────

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
    const limit = typeof invocation.input?.limit === 'number' ? invocation.input.limit : TREE_LIMIT;
    const depth = typeof invocation.input?.depth === 'number' ? invocation.input.depth : 0;
    const ignore = Array.isArray(invocation.input?.ignore)
      ? invocation.input.ignore.map((entry: unknown) => String(entry))
      : [];

    // Single file path (not a directory) — return just that entry
    try {
      const stat = await import('node:fs/promises').then((m) => m.stat(resolved));
      if (!stat.isDirectory()) {
        return {
          path: resolved,
          content: relative(team.workspace.root, resolved) || basename(resolved),
          count: 1,
          truncated: false,
        };
      }
    } catch {
      // Fall through — let fd handle non-existent paths
    }

    // Use fd --json to get structured file/directory listing
    const bin = resolveBinaryPath(FD, 'FD_BIN_PATH');
    const fdArgs: string[] = [
      '--hidden',
      '--no-ignore',
      '--type', 'file',
      '--type', 'directory',
      '--type', 'symlink',
      '--exclude', '.git',
      ...(depth > 0 ? ['--max-depth', String(depth)] : []),
      '--max-results', String(limit),
      '--json',
      '--',
      '.',
      resolved,
    ];

    if (ignore.length > 0) {
      for (const pattern of ignore) {
        fdArgs.push('--exclude', pattern);
      }
    }

    const { stdout, exitCode } = await runCli({
      bin: fdArgs[0]!,
      args: fdArgs.slice(1),
      cwd: team.workspace.root,
      timeout: 5_000,
      maxStdoutBytes: 128_000,
      filterSensitivePaths: true,
    });

    if (exitCode !== 0 && exitCode !== null && exitCode !== 1) {
      throw new Error(`fd (exit ${exitCode})`);
    }

    const rawEntries: FdJsonEntry[] = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) as FdJsonEntry; } catch { return null; }
      })
      .filter((e): e is FdJsonEntry => e !== null);

    // Build tree entries from fd JSON output
    const entries: TreeEntry[] = [];
    for (const raw of rawEntries) {
      const absPath = assertWorkspaceBoundary(team.workspace.root, raw.path);
      if (isSensitiveWorkspacePath(absPath)) continue;
      const rel = relative(resolved, absPath);
      // Skip entries that are at depth 0 (the root itself)
      if (!rel) continue;
      const depthLevel = rel.split('/').length - (raw.type === 'directory' ? 0 : 0);
      // fd includes file depth = 0 for root-level files, handle correctly
      const actualDepth = rel.split('/').length - 1;
      entries.push({
        path: absPath,
        name: raw.name,
        isDir: raw.type === 'directory',
        depth: actualDepth,
      });
    }

    // Sort: dirs first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const content = formatTreeOutput(resourcePath, entries, limit);
    return {
      path: resolved,
      content,
      count: entries.length,
      truncated: entries.length >= limit,
    };
  },
};

// ── Helpers ────────────────────────────────────────────────────────

function formatTreeOutput(rootLabel: string, entries: TreeEntry[], limit: number): string {
  const lines: string[] = [];
  // Normalize the root label (use forward slashes)
  lines.push(rootLabel.split(/[/\\]/).join('/') || '.');
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
