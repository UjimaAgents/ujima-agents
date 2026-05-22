import { z } from 'zod';
import {
  CreateScheduledJobInputSchema,
  ScheduledJobSchema,
  UpdateScheduledJobInputSchema,
} from '@ujima/shared';

export const CreateScheduledJobRequestSchema = CreateScheduledJobInputSchema;
export type CreateScheduledJobRequest = z.infer<typeof CreateScheduledJobRequestSchema>;

export const CreateScheduledJobResponseSchema = z.object({
  job: ScheduledJobSchema,
});
export type CreateScheduledJobResponse = z.infer<typeof CreateScheduledJobResponseSchema>;

export const UpdateScheduledJobRequestSchema = UpdateScheduledJobInputSchema;
export type UpdateScheduledJobRequest = z.infer<typeof UpdateScheduledJobRequestSchema>;

export const UpdateScheduledJobResponseSchema = z.object({
  job: ScheduledJobSchema,
});
export type UpdateScheduledJobResponse = z.infer<typeof UpdateScheduledJobResponseSchema>;

export const ListScheduledJobsResponseSchema = z.object({
  jobs: z.array(ScheduledJobSchema),
});
export type ListScheduledJobsResponse = z.infer<typeof ListScheduledJobsResponseSchema>;

export const GetScheduledJobResponseSchema = z.object({
  job: ScheduledJobSchema,
});
export type GetScheduledJobResponse = z.infer<typeof GetScheduledJobResponseSchema>;
