import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from '@ujima/orchestrator';
import { readSessionToken } from '../session-token.js';

export function requireOrgSession(
  auth: AuthService,
  req: FastifyRequest,
  reply: FastifyReply,
  organizationId: string,
): FastifyReply | undefined {
  const authState = auth.getAuthState(readSessionToken(req));
  if (!authState.member) {
    return reply.code(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Session required' });
  }
  if (authState.user?.organizationId !== organizationId) {
    return reply.code(403).send({ code: 'ERR_FORBIDDEN', message: 'Unauthorized for this organization.' });
  }
  return undefined;
}
