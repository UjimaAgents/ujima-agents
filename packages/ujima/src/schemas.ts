import { z } from 'zod';
import {
  ChannelSchema,
  MemberKindSchema,
  OrganizationChartSchema,
  PROVIDER_KINDS,
  RoleScopesSchema,
  ToolCapabilitySchema,
  WorkspaceConfigSchema,
} from '@ujima/shared';

export const ProviderKindSchema = z.enum(PROVIDER_KINDS);
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const ProviderConfigSchema = z.object({
  kind: ProviderKindSchema,
  apiKeyRef: z.string().min(1).optional(),
  defaultModel: z.string().min(1).optional(),
  /** Optional base URL override — used for `openrouter` and self-hosted `ollama`. */
  baseUrl: z.string().min(1).optional(),
  models: z.array(z.string().min(1)).default([]),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const PolicySchema = z.object({
  requireApprovalForWrites: z.boolean().default(true),
  requireApprovalForShell: z.boolean().default(true),
  workspaceBoundaryMode: z.enum(['hard']).default('hard'),
});
export type PolicyConfig = z.infer<typeof PolicySchema>;

export const PersonalityPresetSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  instructions: z.string().min(1),
});
export type PersonalityPreset = z.infer<typeof PersonalityPresetSchema>;

export const RolePresetSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  instructions: z.string().min(1),
  workspaceScopes: z.array(z.string().min(1)).default([]),
  tools: z.array(z.string().min(1)).default([]),
  channels: z.array(z.string().min(1)).default(['general']),
  skills: z.array(z.string().min(1)).default([]),
});
export type RolePreset = z.infer<typeof RolePresetSchema>;

export const RoleConfigSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  instructions: z.string().min(1),
  kind: MemberKindSchema.default('agent'),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  workspaceScopes: z.array(z.string().min(1)).default([]),
  tools: z.array(z.string().min(1)).default([]),
  channels: z.array(z.string().min(1)).default(['general']),
  skills: z.array(z.string().min(1)).default([]),
});
export type RoleConfig = z.infer<typeof RoleConfigSchema>;

export const AgentConfigSchema = z.object({
  name: z.string().min(1),
  roleName: z.string().min(1),
  personalityName: z.string().min(1).default('direct'),
  kind: MemberKindSchema.default('agent'),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const ChannelConfigSchema = ChannelSchema.extend({
  id: z.string().min(1).optional(),
});
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

export const AgentTeamConfigSchema = z.object({
  name: z.string().min(1).default('Ujima Team'),
  workspace: WorkspaceConfigSchema.default({ root: '.', roleScopes: {} }),
  organizationChart: OrganizationChartSchema.default({ reportsTo: {} }),
  agents: z.array(AgentConfigSchema).default([]),
  providers: z.record(ProviderConfigSchema).default({}),
  roles: z.array(RoleConfigSchema).min(1),
  channels: z.array(ChannelConfigSchema).default([]),
  tools: z.record(ToolCapabilitySchema).default({}),
  policies: PolicySchema.default({
    requireApprovalForWrites: true,
    requireApprovalForShell: true,
    workspaceBoundaryMode: 'hard',
  }),
});
export type AgentTeamConfig = z.infer<typeof AgentTeamConfigSchema>;

export type AgentTeamConfigInput = z.input<typeof AgentTeamConfigSchema>;

// RoleScopesSchema re-used in normalization paths via @ujima/shared
export { RoleScopesSchema };
