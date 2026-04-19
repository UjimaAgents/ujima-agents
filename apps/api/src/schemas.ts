import { IdSchema } from "@ujima/shared";
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

export const OnboardingRequestSchema = z.object({
  organizationName: z.string().min(1),
  workspaceRoot: WorkspaceRootSchema,
  providerKeys: z.record(z.string().min(1)).default({}),
  configFilePath: z.string().min(1).optional(),
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

export const SocketSubscribeSchema = z.object({
  organizationId: IdSchema,
  channelIds: z.array(IdSchema).default([]),
  threadIds: z.array(IdSchema).default([]),
  memberIds: z.array(IdSchema).default([]),
  runIds: z.array(IdSchema).default([]),
});
