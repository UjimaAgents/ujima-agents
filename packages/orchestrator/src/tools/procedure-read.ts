import { z } from 'zod';
import type { OrchestratorTool } from './types.js';
import {
  listProceduresByScope,
  type ProcedureFile,
  type ProcedureScope,
} from '../utils/procedures.js';

const ScopeFilterSchema = z.enum(['all', 'org', 'channel', 'agent']).default('all');

const ProcedureListSchema = z.object({
  scope: ScopeFilterSchema,
  channel_id: z.string().min(1).optional(),
});

const ProcedureViewSchema = z.object({
  name: z.string().min(2).max(64),
  scope: z.enum(['org', 'channel', 'agent']).optional(),
  channel_id: z.string().min(1).optional(),
});

function resolveChannelId(
  invocation: { threadId?: string; organizationId: string },
  repo: { getThread?: (orgId: string, threadId: string) => { channelId?: string } | null | undefined },
  explicit?: string,
): string | undefined {
  if (explicit) return explicit;
  if (!invocation.threadId) return undefined;
  return repo.getThread?.(invocation.organizationId, invocation.threadId)?.channelId;
}

async function gather(
  workspaceRoot: string,
  scope: 'all' | ProcedureScope,
  memberId: string,
  channelId?: string,
): Promise<ProcedureFile[]> {
  const buckets: ProcedureFile[] = [];
  if (scope === 'all' || scope === 'org') {
    buckets.push(...(await listProceduresByScope(workspaceRoot, 'org', '')));
  }
  if ((scope === 'all' || scope === 'channel') && channelId) {
    buckets.push(...(await listProceduresByScope(workspaceRoot, 'channel', channelId)));
  }
  if (scope === 'all' || scope === 'agent') {
    buckets.push(...(await listProceduresByScope(workspaceRoot, 'agent', memberId)));
  }
  return buckets;
}

export const procedureListTool: OrchestratorTool<typeof ProcedureListSchema> = {
  id: 'procedure.list',
  schema: ProcedureListSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: async ({ invocation, team, repo }) => {
    const input = invocation.input as z.infer<typeof ProcedureListSchema>;
    const channelId = resolveChannelId(invocation, repo ?? {}, input.channel_id);
    const all = await gather(team.workspace.root, input.scope, invocation.memberId, channelId);
    return {
      scope: input.scope,
      procedures: all.map((p) => ({
        scope: p.scope,
        name: p.name,
        description: p.description,
        version: p.version,
        enforced: p.enforced,
        updatedAt: p.updatedAt,
      })),
    };
  },
};

export const procedureViewTool: OrchestratorTool<typeof ProcedureViewSchema> = {
  id: 'procedure.view',
  schema: ProcedureViewSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: async ({ invocation, team, repo }) => {
    const input = invocation.input as z.infer<typeof ProcedureViewSchema>;
    const channelId = resolveChannelId(invocation, repo ?? {}, input.channel_id);
    const scopes: ProcedureScope[] = input.scope
      ? [input.scope]
      : ['agent', 'channel', 'org'];
    for (const scope of scopes) {
      const scopeId = scope === 'org' ? '' : scope === 'channel' ? (channelId ?? '') : invocation.memberId;
      if (scope === 'channel' && !channelId) continue;
      const items = await listProceduresByScope(team.workspace.root, scope, scopeId);
      const hit = items.find((p) => p.name === input.name);
      if (hit) {
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
      }
    }
    return {
      ok: false,
      reason: `procedure "${input.name}" not found in scope ${input.scope ?? 'any'}`,
    };
  },
};
