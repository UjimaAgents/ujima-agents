import { z } from "zod";
import {
  ChannelSchema,
  MemberKindSchema,
  RoleScopesSchema,
  ToolCapabilitySchema,
  WorkspaceConfigSchema,
} from "@ujima/shared";

export const ProviderConfigSchema = z.object({
  apiKeyRef: z.string().min(1).optional(),
  defaultModel: z.string().min(1).optional(),
  models: z.array(z.string().min(1)).default([]),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const PolicySchema = z.object({
  requireApprovalForWrites: z.boolean().default(true),
  requireApprovalForShell: z.boolean().default(true),
  workspaceBoundaryMode: z.enum(["hard"]).default("hard"),
});
export type PolicyConfig = z.infer<typeof PolicySchema>;

export const RolePresetSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  instructions: z.string().min(1),
  workspaceScopes: z.array(z.string().min(1)).default([]),
  tools: z.array(z.string().min(1)).default([]),
  channels: z.array(z.string().min(1)).default(["general"]),
  skills: z.array(z.string().min(1)).default([]),
});
export type RolePreset = z.infer<typeof RolePresetSchema>;

export const RoleConfigSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  instructions: z.string().min(1),
  kind: MemberKindSchema.default("agent"),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  workspaceScopes: z.array(z.string().min(1)).default([]),
  tools: z.array(z.string().min(1)).default([]),
  channels: z.array(z.string().min(1)).default(["general"]),
  skills: z.array(z.string().min(1)).default([]),
});
export type RoleConfig = z.infer<typeof RoleConfigSchema>;

export const ChannelConfigSchema = ChannelSchema.extend({
  id: z.string().min(1).optional(),
});
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

export const AgentTeamConfigSchema = z.object({
  name: z.string().min(1),
  workspace: WorkspaceConfigSchema,
  providers: z.record(ProviderConfigSchema).default({}),
  roles: z.array(RoleConfigSchema).min(1),
  channels: z.array(ChannelConfigSchema).default([]),
  tools: z.record(ToolCapabilitySchema).default({}),
  policies: PolicySchema.default({
    requireApprovalForWrites: true,
    requireApprovalForShell: true,
    workspaceBoundaryMode: "hard",
  }),
});
export type AgentTeamConfig = z.infer<typeof AgentTeamConfigSchema>;

export type AgentTeamConfigInput = {
  name?: string;
  workspace: {
    root: string;
    roleScopes?: z.infer<typeof RoleScopesSchema>;
  };
  providers?: Record<string, ProviderConfig>;
  roles: RoleConfig[];
  channels?: ChannelConfig[];
  tools?: Record<string, z.infer<typeof ToolCapabilitySchema>>;
  policies?: Partial<PolicyConfig>;
};
