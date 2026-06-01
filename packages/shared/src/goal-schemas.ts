import { z } from "zod";

const IdSchema = z.string().min(1);
const TimestampSchema = z.string().datetime({ offset: true });

export const GoalStatusSchema = z.enum([
  "planning",
  "running",
  "completed",
  "suspended",
  "cancelled",
]);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

export const GoalTaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "cancelled",
  "failed",
  "blocked_by_failure",
]);
export type GoalTaskStatus = z.infer<typeof GoalTaskStatusSchema>;

export const InteractiveQuestionStatusSchema = z.enum([
  "pending",
  "answered",
  "superseded",
]);
export type InteractiveQuestionStatus = z.infer<typeof InteractiveQuestionStatusSchema>;

export const GoalSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  channelId: IdSchema,
  title: z.string().min(1),
  status: GoalStatusSchema,
  supervisorId: IdSchema,
  planMarkdown: z.string().default(""),
  planVersion: z.number().int().positive().default(1),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Goal = z.infer<typeof GoalSchema>;

export const GoalTaskSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  goalId: IdSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  status: GoalTaskStatusSchema,
  assigneeId: IdSchema,
  createdBy: IdSchema,
  dependsOnTaskId: IdSchema.optional(),
  handoverSummary: z.string().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  // Set by GoalSystemService.nudgeAssignee. The frontend uses it to
  // render a "next nudge in M:SS" countdown on pending task cards.
  lastNudgedAt: TimestampSchema.optional(),
});
export type GoalTask = z.infer<typeof GoalTaskSchema>;

export const InteractiveQuestionSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  channelId: IdSchema,
  goalId: IdSchema.optional(),
  runId: IdSchema.optional(),
  toolCallId: IdSchema.optional(),
  questionText: z.string().min(1),
  options: z.array(z.string().min(1)).min(1),
  status: InteractiveQuestionStatusSchema,
  selectedOption: z.string().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type InteractiveQuestion = z.infer<typeof InteractiveQuestionSchema>;
