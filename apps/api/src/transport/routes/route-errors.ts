import type { FastifyReply } from 'fastify';
import { ERR_NO_WORKSPACE_ROOT, isWorkspaceRootNotReadyError } from './workspace-root.js';

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * An error that carries its own wire representation (status + code + message).
 * Handlers throw these for deliberate, non-2xx responses; the route registry
 * catches them and replies exactly, without further classification.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function httpError(status: number, message: string, code?: string): HttpError {
  return new HttpError(status, message, code);
}

export function apiError(
  reply: FastifyReply,
  status: number,
  message: string,
  code = defaultErrorCode(status),
): FastifyReply {
  return reply.code(status).send({ code, message });
}

export function workspaceRootError(reply: FastifyReply, err: unknown): FastifyReply | null {
  return isWorkspaceRootNotReadyError(err)
    ? apiError(reply, 409, errorMessage(err), ERR_NO_WORKSPACE_ROOT)
    : null;
}

export interface RouteErrorOptions {
  /** Message prefixes (or a regex over the whole message) that map to 404. */
  notFound?: string | string[] | RegExp;
  /** Map any message matching /forbidden/i to 403. */
  forbidden?: boolean;
  /** Map messages starting with a given prefix to the given status. Checked before `notFound`. */
  byPrefix?: Record<string, number>;
  /** Status used when nothing else matches. Defaults to 400. */
  fallback?: number;
  /** Map workspace-root-not-ready errors to 409 ERR_NO_WORKSPACE_ROOT first. */
  workspaceRoot?: boolean;
}

export function routeError(
  reply: FastifyReply,
  err: unknown,
  options: RouteErrorOptions = {},
): FastifyReply {
  if (options.workspaceRoot) {
    const rootError = workspaceRootError(reply, err);
    if (rootError) return rootError;
  }
  const message = errorMessage(err);
  if (options.forbidden && /forbidden/i.test(message)) {
    return apiError(reply, 403, message);
  }
  for (const [prefix, status] of Object.entries(options.byPrefix ?? {})) {
    if (message.startsWith(prefix)) {
      return apiError(reply, status, message);
    }
  }
  const notFound = Array.isArray(options.notFound)
    ? options.notFound
    : options.notFound instanceof RegExp
      ? options.notFound
      : options.notFound
        ? [options.notFound]
        : [];
  const isNotFound = notFound instanceof RegExp
    ? notFound.test(message)
    : notFound.some((prefix) => message.startsWith(prefix));
  if (isNotFound) {
    return apiError(reply, 404, message);
  }
  return apiError(reply, options.fallback ?? 400, message);
}

export function defaultErrorCode(status: number): string {
  if (status === 401) return 'ERR_UNAUTHORIZED';
  if (status === 403) return 'ERR_FORBIDDEN';
  if (status === 404) return 'ERR_NOT_FOUND';
  if (status === 409) return 'ERR_CONFLICT';
  if (status === 500 || status === 503) return 'ERR_INTERNAL';
  return 'ERR_BAD_REQUEST';
}