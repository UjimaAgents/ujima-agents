import { applyPatch } from 'diff';
import { z } from 'zod';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { assertWorkspaceBoundary } from '@ujima/shared/workspace';
import type { OrchestratorTool } from './types.js';
import { readWindowValue } from './window-utils.js';

export const FilesystemSchema = z
  .object({
    action: z.enum(['read', 'write']),
    resourcePath: z
      .string()
      .min(1)
      .describe('Path relative to the workspace root, or absolute within the workspace.'),
    offset: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe('1-based starting line for read.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(20)
      .describe('Maximum number of lines to return for read.'),
    patch: z
      .string()
      .optional()
      .describe(
        'Required for write: a unified diff applied to the current file contents (UTF-8 text). Create new files with a hunk against empty content, e.g. --- /dev/null then +++ b/your/path and @@ -0,0 +1,N @@ plus + lines. For edits, filesystem.read the file first so the patch matches.',
      ),
  })
  .superRefine((val, ctx) => {
    if (val.action === 'write') {
      if (typeof val.patch !== 'string' || !val.patch.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['patch'],
          message: 'Write requires a non-empty unified diff in `patch`.',
        });
      }
    } else if (val.patch !== undefined && val.patch.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['patch'],
        message: 'Do not pass `patch` for read.',
      });
    }

    if (val.action === 'write' && (val.offset !== 1 || val.limit !== 20)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['offset'],
        message: 'Do not pass `offset` or `limit` for write.',
      });
    }
  });

export const filesystemTool: OrchestratorTool<typeof FilesystemSchema> = {
  id: 'filesystem',
  schema: FilesystemSchema,
  toInvocation: (args) => ({
    action: args.action,
    resourceType: 'file',
    resourcePath: args.resourcePath,
    input:
      args.action === 'write'
        ? { patch: args.patch }
        : { offset: args.offset, limit: args.limit },
  }),
  execute: async ({ invocation, team }) => {
    if (!invocation.resourcePath) {
      throw new Error('resourcePath is required');
    }

    const resolved = assertWorkspaceBoundary(
      team.workspace.root,
      invocation.resourcePath,
    );

    if (invocation.action === 'read') {
      const resource = await stat(resolved);
      if (resource.isDirectory()) {
        throw new Error('filesystem.read only supports files, not directories');
      }
      const offset = readWindowValue(invocation.input?.offset, 1);
      const limit = readWindowValue(invocation.input?.limit, 20);
      return {
        type: 'file' as const,
        path: resolved,
        offset,
        limit,
        content: sliceWindow(await readFile(resolved, 'utf8'), offset, limit),
      };
    }

    if (invocation.action === 'write') {
      const patch = invocation.input?.patch as string | undefined;
      if (typeof patch !== 'string' || !patch.trim()) {
        throw new Error("Input 'patch' must be a non-empty unified diff string");
      }

      let before = '';
      try {
        before = await readFile(resolved, 'utf8');
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== 'ENOENT') throw err;
      }

      const after = applyPatch(before, patch);
      if (after === false) {
        throw new Error(
          'Patch did not apply. Use filesystem.read on this path first (edits), or a create-file unified diff from empty (--- /dev/null) for new files.',
        );
      }

      await writeFile(resolved, after, 'utf8');
      return { success: true, path: resolved };
    }

    throw new Error(`Unsupported filesystem action: ${invocation.action}`);
  },
};

function sliceWindow(content: string, offset: number, limit: number): string {
  if (limit <= 0) return '';
  const start = Math.max(offset - 1, 0);
  return content.split(/\r?\n/).slice(start, start + limit).join('\n');
}
