import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

export const ERR_PATH_ESCAPE = 'ERR_PATH_ESCAPE';

/**
 * Thrown when a path requested by a tool, after full `realpath` resolution,
 * lands outside the workspace root or any permitted role-scope subpath.
 *
 * Every path that crosses the daemon boundary should go through `PathResolver`
 * before reaching the filesystem — no `..` normalisation at the caller, only
 * at the resolver. See evolution.md Epic 12.9c.
 */
export class PathEscapeError extends Error {
  readonly code = ERR_PATH_ESCAPE;
  readonly requested: string;
  readonly resolved: string;
  readonly root: string;
  readonly scopePaths: readonly string[];
  constructor(params: { requested: string; resolved: string; root: string; scopePaths: readonly string[] }) {
    super(
      `path escape: "${params.requested}" resolved to "${params.resolved}" which is outside "${params.root}"` +
        (params.scopePaths.length ? ` (scopes: ${params.scopePaths.join(', ')})` : ''),
    );
    this.name = 'PathEscapeError';
    this.requested = params.requested;
    this.resolved = params.resolved;
    this.root = params.root;
    this.scopePaths = params.scopePaths;
  }
}

export interface PathResolveOptions {
  /**
   * Absolute workspace root. Resolved via `realpath` once at construction; all
   * resolved paths must land inside this directory.
   */
  root: string;
  /**
   * Optional list of subtrees (relative to root, or absolute) that further
   * restrict what the caller can reach. When present, a resolved path must
   * land inside at least one of these in addition to the root.
   */
  scopePaths?: readonly string[];
}

export interface PathResolver {
  /**
   * Returns the realpath-resolved absolute path if it's inside the configured
   * root (and, if scopePaths is set, inside at least one scope). Otherwise
   * throws {@link PathEscapeError}. ENOENT is treated as "caller may create
   * it here" — the *intended* parent is resolved instead and checked.
   */
  resolve(requested: string): Promise<string>;
  readonly root: string;
  readonly scopePaths: readonly string[];
}

export async function createPathResolver(opts: PathResolveOptions): Promise<PathResolver> {
  if (!isAbsolute(opts.root)) {
    throw new Error(`PathResolver root must be absolute, got "${opts.root}"`);
  }
  const realRoot = await realpath(opts.root);
  const scopePaths: string[] = [];
  for (const sp of opts.scopePaths ?? []) {
    const candidate = isAbsolute(sp) ? sp : resolve(realRoot, sp);
    const real = await realpathOrParent(candidate);
    if (!withinRoot(realRoot, real)) {
      throw new Error(`scope path "${sp}" is outside workspace root "${realRoot}"`);
    }
    scopePaths.push(real);
  }

  return {
    root: realRoot,
    scopePaths,
    async resolve(requested: string): Promise<string> {
      const candidate = isAbsolute(requested) ? requested : resolve(realRoot, requested);
      const real = await realpathOrParent(candidate);
      if (!withinRoot(realRoot, real)) {
        throw new PathEscapeError({ requested, resolved: real, root: realRoot, scopePaths });
      }
      if (scopePaths.length > 0 && !scopePaths.some((sp) => withinRoot(sp, real))) {
        throw new PathEscapeError({ requested, resolved: real, root: realRoot, scopePaths });
      }
      return real;
    },
  };
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
    // File doesn't exist yet — resolve the deepest existing ancestor so a
    // write to a new path is still subject to the root/scope checks.
    const parent = dirnameStrict(path);
    if (parent === path) return path;
    return realpathOrParent(parent);
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
