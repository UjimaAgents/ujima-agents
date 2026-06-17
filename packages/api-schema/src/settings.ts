import {
  ChannelSchema,
  IdSchema,
  MemberKindSchema,
  MemberSchema,
  MemberShellApprovalModeSchema,
  OrganizationChartSchema,
  OrganizationSchema,
  ShellApprovalModeSchema,
  ToolCapabilitySchema,
  ToolPolicyState,
  WorkspaceConfigSchema,
  PROVIDER_AUTH_MODES,
} from '@ujima/shared';
import { z } from 'zod';

const TeamSettingsRoleSchema = z.object({
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

const TeamSettingsAgentSchema = z.object({
  name: z.string().min(1),
  roleName: z.string().min(1),
  personalityName: z.string().min(1).default('direct'),
  kind: MemberKindSchema.default('agent'),
});

const TeamSettingsChannelSchema = ChannelSchema.extend({
  id: z.string().min(1).optional(),
});

const TeamSettingsPolicySchema = z.object({
  requireApprovalForWrites: z.boolean(),
  requireApprovalForShell: z.boolean().optional(),
  shellApprovalMode: ShellApprovalModeSchema,
  workspaceBoundaryMode: z.string(),
});

/** Team config returned by GET /api/settings/team (providers omitted). */
export const TeamSettingsResponseSchema = z.object({
  name: z.string().min(1),
  workspace: WorkspaceConfigSchema,
  organizationChart: OrganizationChartSchema,
  configVersion: z.number().int().positive().optional(),
  agents: z.array(TeamSettingsAgentSchema).default([]),
  roles: z.array(TeamSettingsRoleSchema).min(1),
  channels: z.array(TeamSettingsChannelSchema).default([]),
  tools: z.record(ToolCapabilitySchema).default({}),
  policies: TeamSettingsPolicySchema,
});
export type TeamSettingsResponse = z.infer<typeof TeamSettingsResponseSchema>;

export const ProviderStatusSchema = z.object({
  name: z.string(),
  hasKey: z.boolean(),
  authMode: z.enum(PROVIDER_AUTH_MODES).optional(),
  baseUrl: z.string().optional(),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

export const ProviderSecretsUpsertSchema = z.object({
  organizationId: IdSchema,
  providerKeys: z.record(z.string().min(1)).default({}),
  providerAuthModes: z.record(z.enum(PROVIDER_AUTH_MODES)).default({}),
  providerBaseUrls: z.record(z.string()).default({}),
});
export type ProviderSecretsUpsertRequest = z.infer<typeof ProviderSecretsUpsertSchema>;

export const ProviderSecretsUpsertResponseSchema = z.object({
  providers: z.array(ProviderStatusSchema),
});
export type ProviderSecretsUpsertResponse = z.infer<typeof ProviderSecretsUpsertResponseSchema>;

export const DiscoveredModelSchema = z.object({
  id: z.string(),
});
export type DiscoveredModel = z.infer<typeof DiscoveredModelSchema>;

export const DiscoverModelsResponseSchema = z.object({
  models: z.array(DiscoveredModelSchema),
});
export type DiscoverModelsResponse = z.infer<typeof DiscoverModelsResponseSchema>;

export const TeamSettingsQuerySchema = z.object({
  organizationId: IdSchema.optional(),
});
export type TeamSettingsQuery = z.infer<typeof TeamSettingsQuerySchema>;

export const OrganizationSettingsQuerySchema = z.object({
  organizationId: IdSchema,
});
export type OrganizationSettingsQuery = z.infer<typeof OrganizationSettingsQuerySchema>;

export const OrganizationSettingsUpdateSchema = z.object({
  organizationId: IdSchema,
  organizationName: z.string().min(1).optional(),
  workspaceRoot: z.string().min(1).optional(),
  organizationChart: OrganizationChartSchema.optional(),
});
export type OrganizationSettingsUpdateRequest = z.infer<typeof OrganizationSettingsUpdateSchema>;

export const OrganizationSettingsResponseSchema = z.object({
  organization: OrganizationSchema,
  members: z.array(MemberSchema),
  channels: z.array(ChannelSchema),
});
export type OrganizationSettingsResponse = z.infer<typeof OrganizationSettingsResponseSchema>;

export const PoliciesUpdateSchema = z.object({
  organizationId: IdSchema,
  requireApprovalForWrites: z.boolean().optional(),
  requireApprovalForShell: z.boolean().optional(),
  shellApprovalMode: ShellApprovalModeSchema.optional(),
});

export const MemberShellApprovalUpdateSchema = z.object({
  shellApprovalMode: MemberShellApprovalModeSchema.optional(),
  llm: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});
export type PoliciesUpdateRequest = z.infer<typeof PoliciesUpdateSchema>;

export const ChannelUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  topic: z.string().optional(),
  memberIds: z.array(IdSchema).optional(),
});
export type ChannelUpdateRequest = z.infer<typeof ChannelUpdateSchema>;

export const ChannelOperationParamsSchema = z.object({
  orgId: IdSchema,
  channelId: IdSchema,
});

/** A single allow-rule record, readable by the frontend. */
export const PolicyAllowRuleSchema = z.object({
  agentId: z.string(),
  mcpId: z.string(),
  toolName: z.string(),
  state: ToolPolicyState,
  reason: z.string().optional(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
});
export type PolicyAllowRule = z.infer<typeof PolicyAllowRuleSchema>;

export const PolicyRulesResponseSchema = z.object({
  rules: z.array(PolicyAllowRuleSchema),
});
export type PolicyRulesResponse = z.infer<typeof PolicyRulesResponseSchema>;

export const RevokePolicyRuleSchema = z.object({
  agentId: z.string(),
  mcpId: z.string(),
  toolName: z.string(),
});
export type RevokePolicyRuleRequest = z.infer<typeof RevokePolicyRuleSchema>;
