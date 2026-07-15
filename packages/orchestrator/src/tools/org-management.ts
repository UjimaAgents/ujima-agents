import { z } from 'zod';
import type { RoleConfig } from '@ujima/framework';
import type { OrchestratorTool } from './types.js';

const RoleConfigSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  instructions: z.string().min(1),
  kind: z.enum(['agent', 'human']).default('agent'),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  workspaceScopes: z.array(z.string().min(1)).default([]),
  tools: z.array(z.string().min(1)).default([]),
  channels: z.array(z.string().min(1)).default(['general']),
  skills: z.array(z.string().min(1)).default([]),
});

const OrgMemberListSchema = z.object({});

const OrgMemberAddSchema = z.object({
  name: z.string().min(1),
  role_name: z.string().min(1),
  channel_ids: z.array(z.string().min(1)).default([]),
  llm: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  personality_name: z.string().min(1).optional(),
  role: RoleConfigSchema.optional(),
});

const OrgMemberUpdateSchema = z.object({
  member_id: z.string().min(1),
  name: z.string().min(1),
  role_name: z.string().min(1),
  channel_ids: z.array(z.string().min(1)).optional(),
  llm: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  personality_name: z.string().min(1),
  role: RoleConfigSchema,
});

const OrgMemberRemoveSchema = z.object({
  member_id: z.string().min(1),
});

const OrgOrganizationGetSchema = z.object({});

const OrgOrganizationUpdateSchema = z.object({
  organization_name: z.string().min(1).optional(),
  workspace_root: z.string().min(1).optional(),
}).refine(
  (value) => value.organization_name !== undefined || value.workspace_root !== undefined,
  { message: 'organization_name or workspace_root is required' },
);

const OrgPoliciesUpdateSchema = z.object({
  require_approval_for_writes: z.boolean().optional(),
  require_approval_for_shell: z.boolean().optional(),
  shell_approval_mode: z.enum(['allow_all', 'auto_review', 'always_review']).optional(),
}).refine(
  (value) =>
    value.require_approval_for_writes !== undefined ||
    value.require_approval_for_shell !== undefined ||
    value.shell_approval_mode !== undefined,
  { message: 'at least one policy field is required' },
);

const GoalChannelViewSchema = z.object({
  channel_id: z.string().min(1).optional(),
});

function invocationChannelId(ctx: Parameters<NonNullable<OrchestratorTool['execute']>>[0]): string {
  const threadId = ctx.invocation.threadId;
  if (!threadId) throw new Error('threadId is required');
  const channelId = ctx.repo.getThread(ctx.invocation.organizationId, threadId)?.channelId;
  if (!channelId) throw new Error('channelId is required');
  return channelId;
}

export const orgMembersListTool: OrchestratorTool<typeof OrgMemberListSchema> = {
  id: 'org.members.list',
  schema: OrgMemberListSchema,
  toInvocation: () => ({
    action: 'read',
    resourceType: 'message',
    bypassPermission: true,
    input: {},
  }),
  execute: (ctx) =>
    ctx.repo
      .listMembers(ctx.invocation.organizationId)
      .filter((member) => !member.retiredAt),
};

export const orgMembersAddTool: OrchestratorTool<typeof OrgMemberAddSchema> = {
  id: 'org.members.add',
  schema: OrgMemberAddSchema,
  toInvocation: (args) => ({
    action: 'write',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: (ctx) => {
    const input = ctx.invocation.input as z.infer<typeof OrgMemberAddSchema>;
    return ctx.settings.addMember({
      organizationId: ctx.invocation.organizationId,
      name: input.name,
      kind: 'agent',
      roleName: input.role_name,
      channelIds: input.channel_ids,
      llm: input.llm,
      model: input.model,
      personalityName: input.personality_name,
      role: input.role as RoleConfig | undefined,
    });
  },
};

export const orgMembersUpdateTool: OrchestratorTool<typeof OrgMemberUpdateSchema> = {
  id: 'org.members.update',
  schema: OrgMemberUpdateSchema,
  toInvocation: (args) => ({
    action: 'write',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: (ctx) => {
    const input = ctx.invocation.input as z.infer<typeof OrgMemberUpdateSchema>;
    return ctx.settings.updateMember({
      organizationId: ctx.invocation.organizationId,
      memberId: input.member_id,
      name: input.name,
      roleName: input.role_name,
      channelIds: input.channel_ids,
      llm: input.llm,
      model: input.model,
      personalityName: input.personality_name,
      role: input.role as RoleConfig,
    });
  },
};

export const orgMembersRemoveTool: OrchestratorTool<typeof OrgMemberRemoveSchema> = {
  id: 'org.members.remove',
  schema: OrgMemberRemoveSchema,
  toInvocation: (args) => ({
    action: 'write',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: (ctx) => {
    const input = ctx.invocation.input as z.infer<typeof OrgMemberRemoveSchema>;
    ctx.settings.deleteMember(ctx.invocation.organizationId, input.member_id);
    return { success: true };
  },
};

export const orgOrganizationGetTool: OrchestratorTool<typeof OrgOrganizationGetSchema> = {
  id: 'org.organization.get',
  schema: OrgOrganizationGetSchema,
  toInvocation: () => ({
    action: 'read',
    resourceType: 'message',
    bypassPermission: true,
    input: {},
  }),
  execute: (ctx) => ctx.settings.getOrganizationSettings(ctx.invocation.organizationId),
};

export const orgOrganizationUpdateTool: OrchestratorTool<typeof OrgOrganizationUpdateSchema> = {
  id: 'org.organization.update',
  schema: OrgOrganizationUpdateSchema,
  toInvocation: (args) => ({
    action: 'write',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: (ctx) => {
    const input = ctx.invocation.input as z.infer<typeof OrgOrganizationUpdateSchema>;
    return ctx.settings.updateOrganizationSettings({
      organizationId: ctx.invocation.organizationId,
      organizationName: input.organization_name,
      workspaceRoot: input.workspace_root,
    });
  },
};

export const orgPoliciesUpdateTool: OrchestratorTool<typeof OrgPoliciesUpdateSchema> = {
  id: 'org.policies.update',
  schema: OrgPoliciesUpdateSchema,
  toInvocation: (args) => ({
    action: 'write',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: (ctx) => {
    const input = ctx.invocation.input as z.infer<typeof OrgPoliciesUpdateSchema>;
    return ctx.settings.updatePolicies({
      organizationId: ctx.invocation.organizationId,
      requireApprovalForWrites: input.require_approval_for_writes,
      requireApprovalForShell: input.require_approval_for_shell,
      shellApprovalMode: input.shell_approval_mode,
    });
  },
};

export const goalChannelViewTool: OrchestratorTool<typeof GoalChannelViewSchema> = {
  id: 'goal.channel.view',
  schema: GoalChannelViewSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'goal',
    bypassPermission: true,
    input: args,
  }),
  execute: (ctx) => {
    const input = ctx.invocation.input as z.infer<typeof GoalChannelViewSchema>;
    const channelId = input.channel_id ?? invocationChannelId(ctx);
    const goal = ctx.repo.getGoalByChannel(ctx.invocation.organizationId, channelId);
    if (!goal) {
      return { goal: null, tasks: [] };
    }
    return {
      goal,
      tasks: ctx.repo.listGoalTasks(ctx.invocation.organizationId, goal.id),
    };
  },
};
