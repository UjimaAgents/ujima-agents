import { z } from 'zod';
import {
  IdSchema,
  PluginInstallSchema,
  SkillInstallSchema,
} from '@ujima/shared';

export const PluginInstallRequestSchema = z.object({
  organizationId: IdSchema,
  createdBy: IdSchema,
  sourceUrl: z.string().min(1),
});
export type PluginInstallRequest = z.infer<typeof PluginInstallRequestSchema>;

export const PluginInstallResponseSchema = z.object({
  plugin: PluginInstallSchema,
  skills: z.array(SkillInstallSchema),
});
export type PluginInstallResponse = z.infer<typeof PluginInstallResponseSchema>;

export const SkillInvocationResponseSchema = z.object({
  skill: SkillInstallSchema,
  content: z.string(),
});
export type SkillInvocationResponse = z.infer<typeof SkillInvocationResponseSchema>;

export const SkillInvocationQuerySchema = z.object({
  organizationId: IdSchema,
  arguments: z.string().optional(),
});
export type SkillInvocationQuery = z.infer<typeof SkillInvocationQuerySchema>;
