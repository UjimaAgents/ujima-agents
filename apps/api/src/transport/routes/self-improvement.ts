import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Repository } from '@ujima/runtime-core';
import type { AuthService } from '@ujima/orchestrator';
import { readSessionToken } from '../session-token.js';
import {
  ListSelfImprovementReviewsResponseSchema,
  GetSelfImprovementReviewResponseSchema,
} from '@ujima/api-schema';

interface SelfImprovementRouteDeps {
  repo: Repository;
  auth: AuthService;
}

export function registerSelfImprovementRoutes(api: FastifyInstance, deps: SelfImprovementRouteDeps): void {
  api.get('/self-improvement/reviews', {
    schema: {
      description: 'List all self-improvement reviews',
      tags: ['Self-Improvement'],
      response: { 200: ListSelfImprovementReviewsResponseSchema },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const authState = deps.auth.getAuthState(readSessionToken(req));
    if (!authState.user) {
      return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    }
    const limit = req.query && typeof (req.query as Record<string, unknown>).limit === 'string'
      ? Math.min(Number((req.query as Record<string, unknown>).limit), 100)
      : 50;
    const reviews = deps.repo.listSelfImprovementReviews(authState.user.organizationId, limit);
    return reply.status(200).send({ reviews });
  });

  api.get('/self-improvement/reviews/:id', {
    schema: {
      description: 'Get a single self-improvement review',
      tags: ['Self-Improvement'],
      response: { 200: GetSelfImprovementReviewResponseSchema },
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const authState = deps.auth.getAuthState(readSessionToken(req));
    if (!authState.user) {
      return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    }
    const review = deps.repo.getSelfImprovementReview(authState.user.organizationId, req.params.id);
    if (!review) {
      return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Review not found' });
    }
    return reply.status(200).send({ review });
  });
}
