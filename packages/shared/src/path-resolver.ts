import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { formatPathEscapeError, type PathEscapeReason } from './path-escape.js';

export const ERR_PATH_ESCAPE = 'ERR_PATH_ESCAPE';

/**
 * Thrown when a path requested by a tool, after full `realpath` resolution,
 * lands outside the workspace root or any permitted role-scope subpath.
 */
export class PathEscapeError extends Error {
  readonly code = ERR_PATH_ESCAPE;
  readonly requested: string;
  readonly resolved: string;
  readonly root: string;
  readonly scopePaths: readonly string[];
  readonly reason: PathEscapeReason;
  constructor(params: {
    requested: string;
    resolved: string;
    root: string;
    scopePaths: readonly string[];
    reason: PathEscapeReason;
  }) {
    super(formatPathEscapeError(params));
    this.name = 'PathEscapeError';
    this.requested = params.requested;
    this.resolved = params.resolved;
    this.root = params.root;
    this.scopePaths = params.scopePaths;
    this.reason = params.reason;
  }
}

export interface PathResolveOptions {
  root: string;
  scopePaths?: readonly string[];
  /**
   * When false, paths may leave role scopes but must stay inside the workspace
   * root. Policy owns out-of-scope approval; use createWorkspaceBoundaryPathResolver.
   */
  enforceRoleScopes?: boolean;
}

export interface PathResolver {
  resolve(requested: string): Promise<string>;
  readonly root: string;
  readonly scopePaths: readonly string[];
}

export async function createWorkspaceBoundaryPathResolver(root: string): Promise<PathResolver> {
  return createPathResolver({ root, scopePaths: [], enforceRoleScopes: false });
}

export async function createRoleScopedPathResolver(
  root: string,
  scopePaths: readonly string[],
): Promise<PathResolver> {
  return createPathResolver({ root, scopePaths, enforceRoleScopes: true });
}

export async function createPathResolver(opts: PathResolveOptions): Promise<PathResolver> {
  if (!isAbsolute(opts.root)) {
    throw new Error(`PathResolver root must be absolute, got "${opts.root}"`);
  }
  const enforceRoleScopes = opts.enforceRoleScopes ?? true;
  const declaredRoot = resolve(opts.root);
  const realRoot = await realpath(opts.root);
  const scopePaths: string[] = [];
  const scopeBoundaryPaths: string[] = [];
  for (const sp of opts.scopePaths ?? []) {
    const candidate = remapCandidateToRealRoot(
      isAbsolute(sp) ? sp : resolve(realRoot, sp),
      declaredRoot,
      realRoot,
    );
    const resolvedScope = await resolveCandidatePath(candidate);
    if (
      !withinRoot(realRoot, resolvedScope.targetPath) ||
      !withinRoot(realRoot, resolvedScope.boundaryPath)
    ) {
      throw new Error(`scope path "${sp}" is outside workspace root "${realRoot}"`);
    }
    scopePaths.push(resolvedScope.targetPath);
    scopeBoundaryPaths.push(resolvedScope.boundaryPath);
  }

  return {
    root: realRoot,
    scopePaths,
    async resolve(requested: string): Promise<string> {
      const candidate = remapCandidateToRealRoot(
        isAbsolute(requested) ? requested : resolve(realRoot, requested),
        declaredRoot,
        realRoot,
      );
      const resolved = await resolveCandidatePath(candidate);
      if (
        !withinRoot(realRoot, resolved.targetPath) ||
        !withinRoot(realRoot, resolved.boundaryPath)
      ) {
        throw new PathEscapeError({
          requested,
          resolved: resolved.boundaryPath,
          root: realRoot,
          scopePaths,
          reason: 'workspace',
        });
      }
      if (
        enforceRoleScopes &&
        scopePaths.length > 0 &&
        !scopePaths.some(
          (sp, index) =>
            withinRoot(sp, resolved.targetPath) &&
            withinRoot(scopeBoundaryPaths[index] ?? sp, resolved.boundaryPath),
        )
      ) {
        throw new PathEscapeError({
          requested,
          resolved: resolved.boundaryPath,
          root: realRoot,
          scopePaths,
          reason: 'scope',
        });
      }
      return resolved.targetPath;
    },
  };
}

function remapCandidateToRealRoot(candidate: string, declaredRoot: string, realRoot: string): string {
  if (withinRoot(realRoot, candidate)) {
    return candidate;
  }
  if (!withinRoot(declaredRoot, candidate)) {
    return candidate;
  }
  return resolve(realRoot, relative(declaredRoot, candidate));
}

function withinRoot(root: string, path: string): boolean {
  if (path === root) return true;
  const prefix = root.endsWith(sep) ? root : root + sep;
  return path.startsWith(prefix);
}

async function realpathOrParent(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (err) {
    if (!isEnoent(err)) throw err;
    const parent = dirnameStrict(path);
    if (parent === path) return path;
    return realpathOrParent(parent);
  }
}

async function resolveCandidatePath(
  path: string,
): Promise<{ targetPath: string; boundaryPath: string }> {
  try {
    const real = await realpath(path);
    return { targetPath: real, boundaryPath: real };
  } catch (err) {
    if (!isEnoent(err)) throw err;
    return {
      targetPath: path,
      boundaryPath: await realpathOrParent(path),
    };
  }
}

function dirnameStrict(p: string): string {
  const idx = p.lastIndexOf(sep);
  if (idx <= 0) return sep;
  return p.slice(0, idx);
}

function isEnoent(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT';
}
