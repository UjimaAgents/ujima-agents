import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AccessibleOrganizationsResponseSchema,
  ApiErrorSchema,
  AuthLoginRequestSchema,
  AuthLogoutResponseSchema,
  AuthSessionResponseSchema,
  AuthSwitchOrganizationRequestSchema,
  SessionAuthStateSchema,
} from '@ujima/api-schema';
import type { AuthService, AuthenticatedSession } from '@ujima/orchestrator';
import { readSessionToken } from '../session-token.js';
import { apiError, errorMessage } from './route-errors.js';

export interface AuthRoutesOptions {
  auth: AuthService;
}

export function registerAuthRoutes(
  _app: FastifyInstance,
  options: AuthRoutesOptions,
): void {
  const { auth } = options;
  const app = _app.withTypeProvider<ZodTypeProvider>();

  app.get('/auth/session', {
    schema: {
      description: 'Resolve the current authenticated user session, if any',
      tags: ['Onboarding'],
      response: {
        200: SessionAuthStateSchema,
      },
    },
  }, async (req) => {
    return auth.getAuthState(readSessionToken(req));
  });

  app.post('/auth/login', {
    schema: {
      description: 'Authenticate a user and issue a durable session token',
      tags: ['Onboarding'],
      body: AuthLoginRequestSchema,
      response: {
        200: AuthSessionResponseSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      return toSessionResponse(auth.login(req.body));
    } catch (err) {
      const message = errorMessage(err);
      if (/invalid email or password/i.test(message)) {
        return apiError(reply, 401, message);
      }
      return apiError(reply, 400, message);
    }
  });

  app.post('/auth/switch-org', {
    schema: {
      description: 'Switch the current session to another organization the user can access',
      tags: ['Onboarding'],
      body: AuthSwitchOrganizationRequestSchema,
      response: {
        200: AuthSessionResponseSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      return toSessionResponse(
        auth.switchOrganization(readSessionToken(req), req.body.organizationId),
      );
    } catch (err) {
      const message = errorMessage(err);
      if (/session required/i.test(message)) {
        return apiError(reply, 401, message);
      }
      if (/do not have access/i.test(message)) {
        return apiError(reply, 403, message);
      }
      return apiError(reply, 400, message);
    }
  });

  app.get('/auth/orgs', {
    schema: {
      description: 'List all organizations accessible to the current user',
      tags: ['Onboarding'],
      response: {
        200: AccessibleOrganizationsResponseSchema,
      },
    },
  }, async (req) => {
    const orgs = auth.listAccessibleOrganizations(readSessionToken(req));
    return { organizations: orgs };
  });

  app.post('/auth/logout', {
    schema: {
      description: 'Revoke the current session token',
      tags: ['Onboarding'],
      response: {
        200: AuthLogoutResponseSchema,
      },
    },
  }, async (req) => {
    return {
      loggedOut: auth.logout(readSessionToken(req)),
    };
  });
}

function toSessionResponse(session: AuthenticatedSession) {
  return {
    auth: {
      authenticated: true as const,
      user: session.user,
      member: session.member,
      session: session.session,
    },
    sessionToken: session.sessionToken,
  };
}
