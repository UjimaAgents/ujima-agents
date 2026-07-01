import { z } from 'zod';
import type { OrchestratorTool } from './types.js';
import {
  executeAddProcedure,
  executeRemoveProcedure,
  executeListProcedures,
  executeViewProcedure,
  executeUpdateProcedure,
} from './self-procedure.js';
import {
  listProceduresByScope,
  type ProcedureFile,
  type ProcedureScope,
} from '../utils/procedures.js';

const OperationSchema = z.enum(['list', 'view', 'add', 'remove', 'update']);

const ProcedureSchema = z.object({
  scope: z.enum(['self', 'org', 'channel', 'agent']).default('self'),
  operation: OperationSchema,
  name: z.string().min(2).max(64).regex(
    /^[a-z0-9][a-z0-9-]{1,63}$/,
    'Use lowercase letters, digits, and hyphens only (2-64 chars).',
  ).optional(),
  description: z.string().min(8).max(200).optional(),
  body: z.string().min(8).max(2000).optional(),
  channel_id: z.string().min(1).optional(),
});

export const procedureTool: OrchestratorTool<typeof ProcedureSchema> = {
  id: 'procedure',
  schema: ProcedureSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: async ({ invocation, team, repo }) => {
    const input = invocation.input as z.infer<typeof ProcedureSchema>;
    const { scope, operation, name, description, body, channel_id } = input;

    if (scope === 'self') {
      if (operation === 'add') {
        if (!name || !description || !body) {
          throw new Error('name, description, and body are required for add operation');
        }
        return executeAddProcedure(team.workspace.root, invocation.memberId, { name, description, body });
      }
      if (operation === 'remove') {
        if (!name) throw new Error('name is required for remove operation');
        return executeRemoveProcedure(team.workspace.root, invocation.memberId, { name });
      }
      if (operation === 'update') {
        if (!name) throw new Error('name is required for update operation');
        return executeUpdateProcedure(team.workspace.root, invocation.memberId, { name, description, body });
      }
      if (operation === 'list') {
        return executeListProcedures(team.workspace.root, invocation.memberId);
      }
      if (operation === 'view') {
        if (!name) throw new Error('name is required for view operation');
        return executeViewProcedure(team.workspace.root, invocation.memberId, { name });
      }
    }

    // org/channel/agent scope — read-only operations
    if (operation === 'add' || operation === 'remove' || operation === 'update') {
      throw new Error(`${operation} is only supported in 'self' scope`);
    }

    const scopeFilter: ProcedureScope = scope as ProcedureScope;
    let channelId = channel_id;
    if (scope === 'channel' && !channelId && invocation.threadId) {
      channelId = (repo as { getThread?: (orgId: string, threadId: string) => { channelId?: string } | null | undefined })
        .getThread?.(invocation.organizationId, invocation.threadId)?.channelId;
    }
    const scopeId = scope === 'org' ? '' : scope === 'channel' ? (channelId ?? '') : invocation.memberId;

    if (operation === 'list') {
      const items = await listProceduresByScope(team.workspace.root, scopeFilter, scopeId);
      return {
        scope,
        procedures: items.map((p: ProcedureFile) => ({
          scope: p.scope,
          name: p.name,
          description: p.description,
          version: p.version,
          enforced: p.enforced,
          updatedAt: p.updatedAt,
        })),
      };
    }

    // view
    if (!name) throw new Error('name is required for view operation');
    const items = await listProceduresByScope(team.workspace.root, scopeFilter, scopeId);
    const hit = items.find((p: ProcedureFile) => p.name === name);
    if (!hit) {
      return { ok: false, reason: `procedure "${name}" not found in scope ${scope}` };
    }
    return {
      ok: true,
      scope: hit.scope,
      name: hit.name,
      description: hit.description,
      body: hit.body,
      version: hit.version,
      enforced: hit.enforced,
      updatedAt: hit.updatedAt,
      updatedBy: hit.updatedBy,
    };
  },
};
