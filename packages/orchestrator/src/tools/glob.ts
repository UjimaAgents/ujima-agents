import { basename, relative } from 'node:path';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { assertWorkspaceBoundary } from '@ujima/shared/workspace';
import { isSensitiveWorkspacePath } from '@ujima/shared/workspace-file-filters';
import { resolveBinaryPath, FD_BINARY } from './binary-resolver.js';
import { runCli } from './cli-runner.js';
import type { OrchestratorTool } from './types.js';
import { readWindowValue } from './window-utils.js';
import { globToRegExp } from './glob-utils.js';

const GLOB_LIMIT = 100;

const GlobSchema = z.object({
  path: z.string().min(1).default('.'),
  pattern: z.string().min(1),
  limit: z.number().int().min(1).max(1000).default(GLOB_LIMIT),
});

export const globTool: OrchestratorTool<typeof GlobSchema> = {
  id: 'glob',
  schema: GlobSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'folder',
    resourcePath: args.path,
    input: {
      pattern: args.pattern,
      limit: args.limit,
    },
  }),
  execute: async ({ invocation, team }) => {
    const searchRoot = assertWorkspaceBoundary(
      team.workspace.root,
      typeof invocation.resourcePath === 'string' ? invocation.resourcePath : '.',
    );
    const resource = await stat(searchRoot);
    const pattern = String(invocation.input?.pattern ?? '').trim();
    const limit = readWindowValue(invocation.input?.limit, GLOB_LIMIT);

    if (!resource.isDirectory()) {
      const rel = relative(team.workspace.root, searchRoot) || basename(searchRoot);
      const matches = matchGlobPattern(pattern, rel) ? [searchRoot] : [];
      return formatGlobResult(searchRoot, pattern, matches, team.workspace.root, limit);
    }

    const bin = resolveBinaryPath(FD_BINARY, 'FD_BIN_PATH');
    const fdArgs = [
      '--glob',
      pattern,
      '--type',
      'f',
      '--max-results',
      String(limit),
      '-a',
      searchRoot,
    ];

    const { stdout, exitCode, stderr } = await runCli({
      bin,
      args: fdArgs,
      cwd: team.workspace.root,
      timeout: 5_000,
      maxStdoutBytes: 256_000,
    });

    if (exitCode !== 0 && exitCode !== null && exitCode !== 1) {
      throw new Error(`fd (exit ${exitCode}): ${stderr.slice(0, 300)}`);
    }

    const matches: string[] = [];
    for (const line of stdout.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
      const absPath = assertWorkspaceBoundary(team.workspace.root, line);
      if (isSensitiveWorkspacePath(absPath)) continue;
      matches.push(absPath);
      if (matches.length >= limit) break;
    }

    return formatGlobResult(searchRoot, pattern, matches, team.workspace.root, limit);
  },
};

function formatGlobResult(
  searchRoot: string,
  pattern: string,
  matches: string[],
  workspaceRoot: string,
  limit: number,
) {
  return {
    path: searchRoot,
    pattern,
    matches,
    count: matches.length,
    truncated: matches.length >= limit,
    content: matches
      .map((entry) => relative(workspaceRoot, entry).split(/[/\\]/).join('/') || entry)
      .join('\n'),
  };
}

function matchGlobPattern(pattern: string, candidate: string): boolean {
  const normalizedPattern = pattern.trim().split(/[/\\]/).join('/');
  const normalizedCandidate = candidate.trim().split(/[/\\]/).join('/');
  if (!normalizedPattern) return false;
  return globToRegExp(normalizedPattern).test(normalizedCandidate);
}

