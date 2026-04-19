import { type RoleScopes } from "./schemas.js";
export declare function normalizeWorkspaceRoot(root: string, baseDirectory?: string): string;
export declare function isPathInsideRoot(root: string, candidatePath: string): boolean;
export declare function resolveWorkspacePath(root: string, relativePath?: string): string;
export declare function normalizeRoleScopes(roleScopes: RoleScopes | undefined, root: string): RoleScopes;
export declare function assertWorkspaceBoundary(root: string, candidatePath: string): string;
//# sourceMappingURL=paths.d.ts.map