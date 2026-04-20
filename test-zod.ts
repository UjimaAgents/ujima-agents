import { z } from "zod";

const RoleScopesSchema = z.record(z.array(z.string().min(1))).default({});
const WorkspaceConfigSchema = z.object({
  root: z.string().min(1),
  roleScopes: RoleScopesSchema,
});

type In = z.input<typeof WorkspaceConfigSchema>;
type Out = z.infer<typeof WorkspaceConfigSchema>;

const input: In = { root: "./" }; // Should compile!
console.log(WorkspaceConfigSchema.parse(input));
