import path from 'path';
import { existsSync, realpathSync } from 'fs';
import { RoleScopesSchema, type RoleScopes } from './org-schemas.js';

export function normalizeWorkspaceRoot(root: string, baseDirectory = process.cwd()): string {
  return path.resolve(baseDirectory, root);
}

export function isPathInsideRoot(root: string, candidatePath: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidatePath);
  const relative = path.relative(normalizedRoot, normalizedCandidate);

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function canonicalWorkspacePath(workspaceRoot: string, candidatePath: string): string {
  const resolved = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(workspaceRoot, candidatePath);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

export function isPathWithinScope(
  workspaceRoot: string,
  scopePath: string,
  resourcePath: string,
): boolean {
  const normalizedScope = canonicalWorkspacePath(workspaceRoot, scopePath);
  const normalizedResource = canonicalWorkspacePath(workspaceRoot, resourcePath);
  return isPathInsideRoot(normalizedScope, normalizedResource);
}

export function resolveWorkspacePath(root: string, relativePath = '.'): string {
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
  const normalizedRoot = path.resolve(root);
  const resolvedCandidate = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(normalizedRoot, candidatePath);
  if (!existsSync(normalizedRoot)) {
    if (!isPathInsideRoot(normalizedRoot, resolvedCandidate)) {
      throw new Error(`Path "${candidatePath}" escapes workspace root "${normalizedRoot}"`);
    }

    return resolvedCandidate;
  }

  const realRoot = realpathSync(normalizedRoot);

  if (existsSync(resolvedCandidate)) {
    const realCandidate = realpathSync(resolvedCandidate);

    if (!isPathInsideRoot(realRoot, realCandidate)) {
      throw new Error(`Path "${candidatePath}" escapes workspace root "${realRoot}"`);
    }

    return realCandidate;
  }

  let ancestor = path.dirname(resolvedCandidate);
  while (ancestor !== path.dirname(ancestor)) {
    if (existsSync(ancestor)) {
      const realAncestor = realpathSync(ancestor);
      if (!isPathInsideRoot(realRoot, realAncestor)) {
        throw new Error(`Path "${candidatePath}" escapes workspace root "${realRoot}"`);
      }

      return resolvedCandidate;
    }

    ancestor = path.dirname(ancestor);
  }

  return resolvedCandidate;
}

export const DEFAULT_GENERAL_CHANNEL = Object.freeze({
  id: 'general',
  name: 'general',
  kind: 'general' as const,
  topic: '',
  memberIds: [] as string[],
});

export const DEFAULT_WORKSPACE_ROLE_SCOPES = Object.freeze<Record<string, string[]>>({});
