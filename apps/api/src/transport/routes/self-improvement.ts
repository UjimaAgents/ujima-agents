import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Repository } from '@ujima/runtime-core';
import type { AuthService } from '@ujima/orchestrator';
import {
  ListSelfImprovementReviewsResponseSchema,
  GetSelfImprovementReviewResponseSchema,
} from '@ujima/api-schema';
import { httpError } from './route-errors.js';
import {
  registerRoute,
  type RouteSpec,
} from './route-registry.js';

interface SelfImprovementRouteDeps {
  repo: Repository;
  auth: AuthService;
}

export function registerSelfImprovementRoutes(api: FastifyInstance, deps: SelfImprovementRouteDeps): void {
  const app = api.withTypeProvider<ZodTypeProvider>();

  const register = (spec: RouteSpec) => registerRoute(app, spec, deps);

  register({
    method: 'get',
    path: '/self-improvement/reviews',
    auth: { kind: 'user' },
    schema: {
      description: 'List all self-improvement reviews',
      tags: ['Self-Improvement'],
      response: { 200: ListSelfImprovementReviewsResponseSchema },
    },
    handler: async (req, { organizationId }) => {
      const limit = req.query && typeof (req.query as Record<string, unknown>).limit === 'string'
        ? Math.min(Number((req.query as Record<string, unknown>).limit), 100)
        : 50;
      const reviews = deps.repo.listSelfImprovementReviews(organizationId, limit);
      return { reviews };
    },
  });

  register({
    method: 'get',
    path: '/self-improvement/reviews/:id',
    auth: { kind: 'user' },
    schema: {
      description: 'Get a single self-improvement review',
      tags: ['Self-Improvement'],
      response: { 200: GetSelfImprovementReviewResponseSchema },
    },
    handler: async (req, { organizationId }) => {
      const review = deps.repo.getSelfImprovementReview(organizationId, req.params.id);
      if (!review) {
        throw httpError(404, 'Review not found');
      }
      return { review };
    },
  });
}