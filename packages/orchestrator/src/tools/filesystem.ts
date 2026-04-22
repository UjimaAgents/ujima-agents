import { z } from 'zod';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { assertWorkspaceBoundary } from '@ujima/shared/workspace';
import type { OrchestratorTool } from './types.js';

export const FilesystemSchema = z.object({
  action: z.enum(['read', 'write']),
  resourcePath: z.string().min(1),
  content: z.string().optional(),
});

export const filesystemTool: OrchestratorTool<typeof FilesystemSchema> = {
  id: 'filesystem',
  schema: FilesystemSchema,
  toInvocation: (args) => ({
    action: args.action,
    resourceType: 'file',
    resourcePath: args.resourcePath,
    input: { content: args.content },
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
        const entries = await readdir(resolved);
        return {
          type: 'folder' as const,
          path: resolved,
          entries,
        };
      }
      return {
        type: 'file' as const,
        path: resolved,
        content: await readFile(resolved, 'utf8'),
      };
    }

    if (invocation.action === 'write') {
      const content = invocation.input?.content as string | undefined;
      if (typeof content !== 'string') {
        throw new Error("Input 'content' must be a string");
      }
      await writeFile(resolved, content, 'utf8');
      return { success: true, path: resolved };
    }

    throw new Error(`Unsupported filesystem action: ${invocation.action}`);
  },
};
