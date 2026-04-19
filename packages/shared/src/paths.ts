import path from "node:path";
import { RoleScopesSchema, type RoleScopes } from "./schemas.js";

export function normalizeWorkspaceRoot(root: string, baseDirectory = process.cwd()): string {
  return path.resolve(baseDirectory, root);
}

export function isPathInsideRoot(root: string, candidatePath: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidatePath);
  const relative = path.relative(normalizedRoot, normalizedCandidate);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveWorkspacePath(root: string, relativePath = "."): string {
  const normalizedRoot = path.resolve(root);
  const resolvedPath = path.resolve(normalizedRoot, relativePath);

  if (!isPathInsideRoot(normalizedRoot, resolvedPath)) {
    throw new Error(`Path "${relativePath}" escapes workspace root "${normalizedRoot}"`);
  }

  return resolvedPath;
}

export function normalizeRoleScopes(roleScopes: RoleScopes = {}, root: string): RoleScopes {
  const normalizedRoot = path.resolve(root);
  const parsedRoleScopes = RoleScopesSchema.parse(roleScopes);

  return Object.fromEntries(
    Object.entries(parsedRoleScopes).map(([roleName, scopes]) => [
      roleName,
      scopes.map((scope) => resolveWorkspacePath(normalizedRoot, scope)),
    ]),
  );
}

export function assertWorkspaceBoundary(root: string, candidatePath: string): string {
  if (!isPathInsideRoot(root, candidatePath)) {
    throw new Error(`Path "${candidatePath}" escapes workspace root "${path.resolve(root)}"`);
  }

  return path.resolve(candidatePath);
}
