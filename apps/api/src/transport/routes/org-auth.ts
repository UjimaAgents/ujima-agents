import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from '@ujima/orchestrator';
import { readSessionToken } from '../session-token.js';
import { apiError } from './route-errors.js';

export function requireOrgSession(
  auth: AuthService,
  req: FastifyRequest,
  reply: FastifyReply,
  organizationId: string,
): FastifyReply | undefined {
  const authState = auth.getAuthState(readSessionToken(req));
  if (!authState.member) {
    return apiError(reply, 401, 'Session required');
  }
  if (authState.user?.organizationId !== organizationId) {
    return apiError(reply, 403, 'Unauthorized for this organization.');
  }
  return undefined;
}
