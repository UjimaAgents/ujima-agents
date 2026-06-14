import { z } from "zod";

export const MemberRoleInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  instructions: z.string().min(1),
  kind: z.enum(["human", "agent"]).default("agent"),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  workspaceScopes: z.array(z.string().min(1)).default([]),
  tools: z.array(z.string().min(1)).default([]),
  channels: z.array(z.string().min(1)).default(["general"]),
  skills: z.array(z.string().min(1)).default([]),
});
