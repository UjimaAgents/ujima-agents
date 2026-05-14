import { z } from "zod";

export const GoalStatusSchema = z.enum([
  "draft",
  "planning",
  "in_progress",
  "completed",
  "failed",
]);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

