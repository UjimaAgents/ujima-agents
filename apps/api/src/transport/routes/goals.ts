import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Repository } from '@ujima/runtime-core';
import type { AuthService, AuthState, ConversationService, GoalSystemService } from '@ujima/orchestrator';
import { GoalTaskStatusSchema, type Goal, type InteractiveQuestion } from '@ujima/shared';
import { z } from 'zod';
import { readSessionToken } from '../session-token.js';

interface GoalRouteDeps {
  repo: Repository;
  auth: AuthService;
  goals: GoalSystemService;
  conversations: ConversationService;
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
  const status = /forbidden/i.test(message)
    ? 403
    : /not found/i.test(message)
      ? 404
      : 400;
  return reply.status(status).send({
    code: status === 403 ? 'ERR_FORBIDDEN' : status === 404 ? 'ERR_NOT_FOUND' : 'ERR_BAD_REQUEST',
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

function canAccessChannel(
  deps: GoalRouteDeps,
  organizationId: string,
  channelId: string,
  memberId: string,
): boolean {
  const channel = deps.repo.getChannel(organizationId, channelId);
  const member = deps.repo.getMember(organizationId, memberId);
  if (!channel || channel.archivedAt || !member || member.retiredAt) return false;
  if (channel.kind === 'self' || channel.kind === 'dm') return channel.memberIds.includes(memberId);
  return true;
}

function requireThreadAccess(
  deps: GoalRouteDeps,
  reply: FastifyReply,
  organizationId: string,
  threadId: string,
  memberId: string,
  access: 'read' | 'write' = 'read',
): boolean {
  try {
    deps.conversations.requireThreadAccess(organizationId, threadId, memberId, access);
    return true;
  } catch (error) {
    sendRouteError(reply, error);
    return false;
  }
}

function requireGoalAccess(
  deps: GoalRouteDeps,
  reply: FastifyReply,
  organizationId: string,
  goalId: string,
  memberId: string,
): Goal | null {
  const goal = deps.repo.getGoal(organizationId, goalId);
  if (!goal) {
    reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Goal not found' });
    return null;
  }
  if (!canAccessChannel(deps, organizationId, goal.channelId, memberId)) {
    reply.status(403).send({ code: 'ERR_FORBIDDEN', message: 'Forbidden: you do not have access to this goal' });
    return null;
  }
  return goal;
}

function requireQuestionAccess(
  deps: GoalRouteDeps,
  reply: FastifyReply,
  organizationId: string,
  questionId: string,
  memberId: string,
): InteractiveQuestion | null {
  const question = deps.repo.getInteractiveQuestion(organizationId, questionId);
  if (!question) {
    reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Question not found' });
    return null;
  }
  if (!questionRunIsLive(deps, organizationId, question.runId)) {
    reply.status(409).send({ code: 'ERR_CONFLICT', message: 'Question belongs to a run that is no longer active' });
    return null;
  }
  if (!canAccessChannel(deps, organizationId, question.channelId, memberId)) {
    reply.status(403).send({ code: 'ERR_FORBIDDEN', message: 'Forbidden: you do not have access to this question' });
    return null;
  }
  return question;
}

function listVisiblePendingQuestions(
  deps: GoalRouteDeps,
  organizationId: string,
  channelId: string,
  memberId: string,
): InteractiveQuestion[] {
  return deps.repo
    .listPendingInteractiveQuestions(organizationId, channelId)
    .filter((question) => questionRunIsLive(deps, organizationId, question.runId))
    .filter((question) => canAccessChannel(deps, organizationId, question.channelId, memberId));
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
      if (!requireThreadAccess(deps, reply, auth.user.organizationId, threadId, auth.member.id, 'read')) return;
      const thread = deps.repo.getThread(auth.user.organizationId, threadId);
      const channelId = thread?.channelId ?? threadId;
      return reply.status(200).send({
        questions: listVisiblePendingQuestions(deps, auth.user.organizationId, channelId, auth.member.id),
      });
    }
    if (runId) {
      const run = deps.repo.getRun(auth.user.organizationId, runId);
      if (!run || !questionRunIsLive(deps, auth.user.organizationId, runId)) {
        return reply.status(200).send({ questions: [] });
      }
      if (
        run.threadId &&
        !requireThreadAccess(deps, reply, auth.user.organizationId, run.threadId, auth.member.id, 'read')
      ) {
        return;
      }
      return reply.status(200).send({
        questions: deps.repo
          .listInteractiveQuestionsByRunId(auth.user.organizationId, runId)
          .filter((question) => question.status === 'pending')
          .filter((question) => canAccessChannel(deps, auth.user.organizationId, question.channelId, auth.member.id)),
      });
    }
    return reply.status(400).send({ code: 'ERR_BAD_REQUEST', message: 'runId or threadId is required' });
  });

  api.get('/goals', async (req: FastifyRequest<{ Querystring: { channelId?: string } }>, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    if (req.query.channelId) {
      if (!requireThreadAccess(deps, reply, auth.user.organizationId, req.query.channelId, auth.member.id, 'read')) return;
      return reply.status(200).send({
        goals: deps.repo.listGoalsByChannel(auth.user.organizationId, req.query.channelId),
      });
    }
    return reply.status(200).send({
      goals: deps.repo
        .listGoals(auth.user.organizationId)
        .filter((goal) => canAccessChannel(deps, auth.user.organizationId, goal.channelId, auth.member.id)),
    });
  });

  api.get('/goals/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    const goal = requireGoalAccess(deps, reply, auth.user.organizationId, req.params.id, auth.member.id);
    if (!goal) return;
    return reply.status(200).send({
      goal,
      tasks: deps.repo.listGoalTasks(auth.user.organizationId, goal.id),
      questions: listVisiblePendingQuestions(deps, auth.user.organizationId, goal.channelId, auth.member.id)
        .filter((q) => q.goalId === goal.id),
    });
  });

  api.post('/goals/:id/implement', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    try {
      if (!requireGoalAccess(deps, reply, auth.user.organizationId, req.params.id, auth.member.id)) return;
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
      const existing = deps.repo.getGoalTask(auth.user.organizationId, req.params.id);
      if (!existing) return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Task not found' });
      const goal = requireGoalAccess(deps, reply, auth.user.organizationId, existing.goalId, auth.member.id);
      if (!goal) return;
      const task = deps.goals.updateTask({
        organizationId: auth.user.organizationId,
        taskId: req.params.id,
        status: req.body.status,
        handoverSummary: req.body.handoverSummary,
        callerMemberId: auth.member.id,
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
      if (!requireQuestionAccess(deps, reply, auth.user.organizationId, req.params.id, auth.member.id)) return;
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
      if (!requireQuestionAccess(deps, reply, auth.user.organizationId, req.params.id, auth.member.id)) return;
      return reply.status(200).send({
        question: deps.goals.supersede(auth.user.organizationId, req.params.id),
      });
    } catch (error) {
      return sendRouteError(reply, error);
    }
  });
}
