import {
  ChannelSchema,
  IdSchema,
  MemberSchema,
  OrganizationChartSchema,
  OrganizationSchema,
} from '@ujima/shared';
import { z } from 'zod';

export const ProviderStatusSchema = z.object({
  name: z.string(),
  hasKey: z.boolean(),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

export const ProviderSecretsUpsertSchema = z.object({
  organizationId: IdSchema,
  providerKeys: z.record(z.string().min(1)).default({}),
});
export type ProviderSecretsUpsertRequest = z.infer<typeof ProviderSecretsUpsertSchema>;

export const ProviderSecretsUpsertResponseSchema = z.object({
  providers: z.array(ProviderStatusSchema),
});
export type ProviderSecretsUpsertResponse = z.infer<typeof ProviderSecretsUpsertResponseSchema>;

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
  organizationChart: OrganizationChartSchema.optional(),
});
export type OrganizationSettingsUpdateRequest = z.infer<typeof OrganizationSettingsUpdateSchema>;

export const OrganizationSettingsResponseSchema = z.object({
  organization: OrganizationSchema,
  members: z.array(MemberSchema),
  channels: z.array(ChannelSchema),
});
export type OrganizationSettingsResponse = z.infer<typeof OrganizationSettingsResponseSchema>;

