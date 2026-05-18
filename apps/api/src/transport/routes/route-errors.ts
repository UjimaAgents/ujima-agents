import type { FastifyReply } from 'fastify';
import { ERR_NO_WORKSPACE_ROOT, isWorkspaceRootNotReadyError } from './workspace-root.js';

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

export function routeError(
  reply: FastifyReply,
  err: unknown,
  options: { notFound?: string | string[]; fallback?: number; workspaceRoot?: boolean } = {},
): FastifyReply {
  if (options.workspaceRoot) {
    const rootError = workspaceRootError(reply, err);
    if (rootError) return rootError;
  }
  const message = errorMessage(err);
  const notFound = Array.isArray(options.notFound)
    ? options.notFound
    : options.notFound
      ? [options.notFound]
      : [];
  return apiError(
    reply,
    notFound.some((prefix) => message.startsWith(prefix)) ? 404 : options.fallback ?? 400,
    message,
  );
}

export function defaultErrorCode(status: number): string {
  if (status === 401) return 'ERR_UNAUTHORIZED';
  if (status === 403) return 'ERR_FORBIDDEN';
  if (status === 404) return 'ERR_NOT_FOUND';
  if (status === 409) return 'ERR_CONFLICT';
  if (status === 500 || status === 503) return 'ERR_INTERNAL';
  return 'ERR_BAD_REQUEST';
}
