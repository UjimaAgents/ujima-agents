import {
  ApprovalRequestSchema,
  AuthSessionSchema,
  AuthUserSchema,
  ChannelSchema,
  IdSchema,
  MemberSchema,
  OrganizationChartSchema,
  RunStateSchema,
} from '@ujima/shared';
import { AgentTeamConfigSchema } from '@ujima/framework';
import { z } from 'zod';
import { SessionAuthStateSchema } from './auth.js';

const WorkspaceRootSchema = z.string().min(1);

const InlineTeamConfigSchema = AgentTeamConfigSchema.pick({
  name: true,
  agents: true,
  roles: true,
  channels: true,
  providers: true,
  organizationChart: true,
  policies: true,
}).partial();
export type InlineTeamConfig = z.infer<typeof InlineTeamConfigSchema>;

export const OnboardingRequestSchema = z.object({
  organizationName: z.string().min(1),
  ownerName: z.string().min(1),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(8),
  workspaceRoot: WorkspaceRootSchema,
  providerKeys: z.record(z.string().min(1)).default({}),
  team: InlineTeamConfigSchema,
});
export type OnboardingRequest = z.infer<typeof OnboardingRequestSchema>;

export const TeamSummarySchema = z.object({
  name: z.string(),
  workspaceRoot: z.string(),
  roles: z.array(z.string()),
  agents: z.array(z.string()),
  channels: z.array(z.string()),
});
export type TeamSummary = z.infer<typeof TeamSummarySchema>;

export const OnboardingResponseSchema = z.object({
  organization: z.object({ id: IdSchema, name: z.string() }),
  members: z.array(MemberSchema),
  channels: z.array(ChannelSchema),
  team: TeamSummarySchema,
  auth: SessionAuthStateSchema.extend({
    authenticated: z.literal(true),
    user: AuthUserSchema,
    member: MemberSchema,
    session: AuthSessionSchema,
  }),
  sessionToken: z.string().min(1),
});
export type OnboardingResponse = z.infer<typeof OnboardingResponseSchema>;

export const BootstrapResponseSchema = z.object({
  serviceReady: z.literal(true),
  onboardingStatus: z.enum(['pending', 'ready']),
  organization: z.object({ id: IdSchema, name: z.string() }).nullable(),
  team: TeamSummarySchema.extend({
    organizationChart: OrganizationChartSchema.optional(),
  })
    .partial({ organizationChart: true })
    .nullable(),
  providers: z.array(z.object({ name: z.string(), hasKey: z.boolean() })),
  members: z.array(MemberSchema),
  channels: z.array(ChannelSchema),
  pendingApprovals: z.array(ApprovalRequestSchema),
  activeRuns: z.array(RunStateSchema),
  auth: SessionAuthStateSchema,
});
export type BootstrapResponse = z.infer<typeof BootstrapResponseSchema>;
