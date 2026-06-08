import { z } from 'zod';
import { relative } from 'node:path';
import { assertWorkspaceBoundary } from '@ujima/shared/workspace';
import { isSensitiveWorkspacePath } from '@ujima/shared/workspace-file-filters';
import { resolveBinaryPath, type BinaryDescriptor } from './binary-resolver.js';
import { runCli } from './cli-runner.js';
import type { OrchestratorTool } from './types.js';

const FD: BinaryDescriptor = { name: 'fd', dir: 'fd', filename: 'fd' };

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
    const pattern = String(invocation.input?.pattern ?? '').trim();
    const limit = typeof invocation.input?.limit === 'number' ? invocation.input.limit : GLOB_LIMIT;

    const bin = resolveBinaryPath(FD, 'FD_BIN_PATH');
    const args = [
      '--glob',
      '--type', 'file',
      '--max-results', String(limit),
      '--',
      pattern,
      searchRoot,
    ];
    const { stdout, exitCode } = await runCli({
      bin,
      args,
      cwd: team.workspace.root,
      timeout: 5_000,
      maxStdoutBytes: 64_000,
      filterSensitivePaths: true,
    });

    if (exitCode !== 0 && exitCode !== null) {
      // fd exits 1 when no results — that's not an error
      if (exitCode !== 1) {
        throw new Error(`fd (exit ${exitCode})`);
      }
    }

    const relPaths = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const matches: string[] = [];
    for (const relPath of relPaths) {
      const fullPath = relative(team.workspace.root, relPath)
        ? assertWorkspaceBoundary(team.workspace.root, relPath)
        : team.workspace.root;
      if (isSensitiveWorkspacePath(fullPath)) continue;
      matches.push(fullPath);
      if (matches.length >= limit) break;
    }

    return {
      path: searchRoot,
      pattern,
      matches,
      count: matches.length,
      truncated: matches.length >= limit,
      content: matches
        .map((entry) => relative(team.workspace.root, entry) || entry)
        .join('\n'),
    };
  },
};
