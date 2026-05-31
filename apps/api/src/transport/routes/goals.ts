import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Repository } from '@ujima/runtime-core';
import type { AuthService, AuthState, GoalSystemService } from '@ujima/orchestrator';
import { GoalTaskStatusSchema } from '@ujima/shared';
import { z } from 'zod';
import { readSessionToken } from '../session-token.js';

interface GoalRouteDeps {
  repo: Repository;
  auth: AuthService;
  goals: GoalSystemService;
}

type AuthedMember = AuthState & {
  user: NonNullable<AuthState['user']>;
  member: NonNullable<AuthState['member']>;
};

const StatusBodySchema = z.object({
  status: GoalTaskStatusSchema,
  handoverSummary: z.string().min(1).optional(),
});
const AnswerBodySchema = z.object({ selectedOption: z.string().min(1) });

function sendRouteError(reply: FastifyReply, error: unknown): FastifyReply {
  const message = error instanceof Error ? error.message : String(error);
  const status = /not found/i.test(message) ? 404 : 400;
  return reply.status(status).send({
    code: status === 404 ? 'ERR_NOT_FOUND' : 'ERR_BAD_REQUEST',
    message,
  });
}

function requireMember(
  deps: GoalRouteDeps,
  req: FastifyRequest,
  reply: FastifyReply,
): AuthedMember | null {
  const authState = deps.auth.getAuthState(readSessionToken(req));
  if (!authState.user || !authState.member) {
    reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    return null;
  }
  return { ...authState, user: authState.user, member: authState.member };
}

function questionRunIsLive(deps: GoalRouteDeps, organizationId: string, runId: string | undefined): boolean {
  if (!runId) return true;
  const run = deps.repo.getRun(organizationId, runId);
  return (
    run?.status === 'queued' ||
    run?.status === 'running' ||
    run?.status === 'waiting_for_approval' ||
    run?.status === 'waiting_for_input'
  );
}

export function registerGoalRoutes(api: FastifyInstance, deps: GoalRouteDeps): void {
  api.get('/questions', async (req: FastifyRequest<{ Querystring: { runId?: string; threadId?: string } }>, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    const { runId, threadId } = req.query;
    if (!runId && !threadId) {
      return reply.status(400).send({ code: 'ERR_BAD_REQUEST', message: 'runId or threadId is required' });
    }
    if (threadId) {
      return reply.status(200).send({
        questions: deps.repo
          .listPendingInteractiveQuestions(auth.user.organizationId, threadId)
          .filter((question) => questionRunIsLive(deps, auth.user.organizationId, question.runId)),
      });
    }
    if (runId) {
      return reply.status(200).send({
        questions: deps.repo
          .listInteractiveQuestionsByRunId(auth.user.organizationId, runId)
          .filter((question) => question.status === 'pending'),
      });
    }
    return reply.status(400).send({ code: 'ERR_BAD_REQUEST', message: 'runId or threadId is required' });
  });

  api.get('/goals', async (req, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    return reply.status(200).send({ goals: deps.repo.listGoals(auth.user.organizationId) });
  });

  api.get('/goals/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    const goal = deps.repo.getGoal(auth.user.organizationId, req.params.id);
    if (!goal) return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Goal not found' });
    return reply.status(200).send({
      goal,
      tasks: deps.repo.listGoalTasks(auth.user.organizationId, goal.id),
      questions: deps.repo.listPendingInteractiveQuestions(auth.user.organizationId, goal.channelId),
    });
  });

  api.post('/goals/:id/implement', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    try {
      return reply.status(200).send(deps.goals.implement(auth.user.organizationId, req.params.id));
    } catch (error) {
      return sendRouteError(reply, error);
    }
  });

  api.patch('/goal-tasks/:id/status', {
    schema: { body: StatusBodySchema },
  }, async (req: FastifyRequest<{ Params: { id: string }; Body: z.infer<typeof StatusBodySchema> }>, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    try {
      const task = deps.goals.updateTask({
        organizationId: auth.user.organizationId,
        taskId: req.params.id,
        status: req.body.status,
        handoverSummary: req.body.handoverSummary,
      });
      if (!task) return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Task not found' });
      return reply.status(200).send({ task });
    } catch (error) {
      return sendRouteError(reply, error);
    }
  });

  api.post('/questions/:id/answer', {
    schema: { body: AnswerBodySchema },
  }, async (req: FastifyRequest<{ Params: { id: string }; Body: z.infer<typeof AnswerBodySchema> }>, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    try {
      return reply.status(200).send({
        question: await deps.goals.answer(auth.user.organizationId, req.params.id, req.body.selectedOption),
      });
    } catch (error) {
      return sendRouteError(reply, error);
    }
  });

  api.post('/questions/:id/supersede', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    try {
      return reply.status(200).send({
        question: deps.goals.supersede(auth.user.organizationId, req.params.id),
      });
    } catch (error) {
      return sendRouteError(reply, error);
    }
  });
}
