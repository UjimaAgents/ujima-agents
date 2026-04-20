import { IdSchema, OrganizationChartSchema } from "@ujima/shared";
import { AgentTeamConfigSchema } from "@ujima/framework";
import { z } from "zod";

const WorkspaceRootSchema = z.string().min(1);

export const BootstrapResponseSchema = z.object({
  serviceReady: z.literal(true),
  onboardingStatus: z.enum(["pending", "ready"]),
  organization: z.object({
    id: IdSchema,
    name: z.string(),
  }).nullable(),
  team: z
    .object({
      name: z.string(),
      workspaceRoot: z.string(),
      roles: z.array(z.string()),
      channels: z.array(z.string()),
    })
    .nullable(),
  providers: z.array(
    z.object({
      name: z.string(),
      hasKey: z.boolean(),
    }),
  ),
});

/**
 * Inline team configuration that can be provided to bootstrap the organization
 * without a ujima.config.ts file on disk.
 *
 * When `team` is omitted, the server falls back to loading from the config file.
 */
const InlineTeamConfigSchema = AgentTeamConfigSchema.pick({
  name: true,
  agents: true,
  roles: true,
  channels: true,
  providers: true,
  organizationChart: true,
  policies: true,
}).partial();

export const OnboardingRequestSchema = z.object({
  organizationName: z.string().min(1),
  ownerName: z.string().min(1),
  workspaceRoot: WorkspaceRootSchema,
  providerKeys: z.record(z.string().min(1)).default({}),
  configFilePath: z.string().min(1).optional(),
  /** Inline team definition — if provided, no config file is needed on disk. */
  team: InlineTeamConfigSchema.optional(),
});

export const ProviderSecretsUpsertSchema = z.object({
  organizationId: IdSchema,
  providerKeys: z.record(z.string().min(1)).default({}),
});

export const OrganizationQuerySchema = z.object({
  organizationId: IdSchema,
});

export const MessageCreateSchema = z.object({
  organizationId: IdSchema,
  threadId: IdSchema,
  channelId: IdSchema.optional(),
  senderId: IdSchema,
  content: z.string().min(1),
});

export const RunCreateSchema = z.object({
  organizationId: IdSchema,
  agentId: IdSchema,
  threadId: IdSchema,
  summary: z.string().min(1).optional(),
});

export const ApprovalResolveSchema = z.object({
  organizationId: IdSchema,
  status: z.enum(["approved", "rejected"]),
  reason: z.string().default(""),
});

export const TeamSettingsQuerySchema = z.object({
  organizationId: IdSchema.optional(),
});

export const OrganizationSettingsQuerySchema = z.object({
  organizationId: IdSchema,
});

export const OrganizationSettingsUpdateSchema = z.object({
  organizationId: IdSchema,
  organizationName: z.string().min(1).optional(),
  organizationChart: OrganizationChartSchema.optional(),
});

export const SocketSubscribeSchema = z.object({
  organizationId: IdSchema,
  channelIds: z.array(IdSchema).default([]),
  threadIds: z.array(IdSchema).default([]),
  memberIds: z.array(IdSchema).default([]),
  runIds: z.array(IdSchema).default([]),
});
