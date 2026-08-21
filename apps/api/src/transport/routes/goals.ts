import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Repository } from '@ujima/runtime-core';
import type { AuthService, AuthState, ConversationService, GoalSystemService } from '@ujima/orchestrator';
import { publishGoalTaskUpdatedCard } from '@ujima/orchestrator';
import { GoalTaskStatusSchema, type Goal, type InteractiveQuestion } from '@ujima/shared';
import { z } from 'zod';
import { httpError } from './route-errors.js';
import {
  registerRoute,
  type RouteSpec,
} from './route-registry.js';

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

const UpdateTaskBodySchema = z.object({
  title: z.string().min(1).optional(),
  assigneeId: z.string().min(1).optional(),
});

const StatusBodySchema = z.object({
  status: GoalTaskStatusSchema,
  handoverSummary: z.string().min(1).optional(),
});
const AnswerBodySchema = z.object({ selectedOption: z.string().min(1) });

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
    const message = error instanceof Error ? error.message : String(error);
    const status = /forbidden/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 400;
    reply.status(status).send({
      code: status === 403 ? 'ERR_FORBIDDEN' : status === 404 ? 'ERR_NOT_FOUND' : 'ERR_BAD_REQUEST',
      message,
    });
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
  const app = api.withTypeProvider<ZodTypeProvider>();

  const register = (spec: RouteSpec) => registerRoute(app, spec, deps);

  // sendRouteError semantics: /forbidden/i → 403, /not found/i → 404, else 400.
  const goalError = { forbidden: true, notFound: /not found/i, fallback: 400 };

  register({
    method: 'get',
    path: '/questions',
    auth: { kind: 'member' },
    handler: async (req, { authState, reply }) => {
      const auth = authState as AuthedMember;
      const { runId, threadId } = req.query;
      if (!runId && !threadId) {
        return reply.status(400).send({ code: 'ERR_BAD_REQUEST', message: 'runId or threadId is required' });
      }
      if (threadId) {
        if (!requireThreadAccess(deps, reply, auth.user.organizationId, threadId, auth.member.id, 'read')) return;
        const thread = deps.repo.getThread(auth.user.organizationId, threadId);
        const channelId = thread?.channelId ?? threadId;
        return {
          questions: listVisiblePendingQuestions(deps, auth.user.organizationId, channelId, auth.member.id),
        };
      }
      if (runId) {
        const run = deps.repo.getRun(auth.user.organizationId, runId);
        if (!run || !questionRunIsLive(deps, auth.user.organizationId, runId)) {
          return { questions: [] };
        }
        if (
          run.threadId &&
          !requireThreadAccess(deps, reply, auth.user.organizationId, run.threadId, auth.member.id, 'read')
        ) {
          return;
        }
        return {
          questions: deps.repo
            .listInteractiveQuestionsByRunId(auth.user.organizationId, runId)
            .filter((question) => question.status === 'pending')
            .filter((question) => canAccessChannel(deps, auth.user.organizationId, question.channelId, auth.member.id)),
        };
      }
      return reply.status(400).send({ code: 'ERR_BAD_REQUEST', message: 'runId or threadId is required' });
    },
  });

  register({
    method: 'get',
    path: '/goals',
    auth: { kind: 'member' },
    handler: async (req, { authState, reply }) => {
      const auth = authState as AuthedMember;
      if (req.query.channelId) {
        if (!requireThreadAccess(deps, reply, auth.user.organizationId, req.query.channelId, auth.member.id, 'read')) return;
        return {
          goals: deps.repo.listGoalsByChannel(auth.user.organizationId, req.query.channelId),
        };
      }
      return {
        goals: deps.repo
          .listGoals(auth.user.organizationId)
          .filter((goal) => canAccessChannel(deps, auth.user.organizationId, goal.channelId, auth.member.id)),
      };
    },
  });

  register({
    method: 'get',
    path: '/goals/:id',
    auth: { kind: 'member' },
    handler: async (req, { authState, reply }) => {
      const auth = authState as AuthedMember;
      const goal = requireGoalAccess(deps, reply, auth.user.organizationId, req.params.id, auth.member.id);
      if (!goal) return;
      return {
        goal,
        tasks: deps.repo.listGoalTasks(auth.user.organizationId, goal.id),
        questions: listVisiblePendingQuestions(deps, auth.user.organizationId, goal.channelId, auth.member.id)
          .filter((q) => q.goalId === goal.id),
      };
    },
  });

  register({
    method: 'post',
    path: '/goals/:id/implement',
    auth: { kind: 'member' },
    error: goalError,
    handler: async (req, { authState, reply }) => {
      const auth = authState as AuthedMember;
      if (!requireGoalAccess(deps, reply, auth.user.organizationId, req.params.id, auth.member.id)) return;
      return deps.goals.implement(auth.user.organizationId, req.params.id);
    },
  });

  register({
    method: 'patch',
    path: '/goal-tasks/:id',
    auth: { kind: 'member' },
    schema: { body: UpdateTaskBodySchema },
    error: goalError,
    handler: async (req, { authState }) => {
      const auth = authState as AuthedMember;
      const existing = deps.repo.getGoalTask(auth.user.organizationId, req.params.id);
      if (!existing) throw httpError(404, 'Task not found');
      const task = deps.goals.updateTask({
        organizationId: auth.user.organizationId,
        taskId: req.params.id,
        title: req.body.title,
        assigneeId: req.body.assigneeId,
        callerMemberId: auth.member.id,
      });
      if (!task) throw httpError(404, 'Task not found');
      return { task };
    },
  });

  register({
    method: 'patch',
    path: '/goal-tasks/:id/status',
    auth: { kind: 'member' },
    schema: { body: StatusBodySchema },
    error: goalError,
    handler: async (req, { authState, reply }) => {
      const auth = authState as AuthedMember;
      const existing = deps.repo.getGoalTask(auth.user.organizationId, req.params.id);
      if (!existing) throw httpError(404, 'Task not found');
      const goal = requireGoalAccess(deps, reply, auth.user.organizationId, existing.goalId, auth.member.id);
      if (!goal) return;
      const task = deps.goals.updateTask({
        organizationId: auth.user.organizationId,
        taskId: req.params.id,
        status: req.body.status,
        handoverSummary: req.body.handoverSummary,
        callerMemberId: auth.member.id,
      });
      if (!task) throw httpError(404, 'Task not found');
      if (existing.status !== task.status) {
        publishGoalTaskUpdatedCard({
          conversations: deps.conversations,
          organizationId: auth.user.organizationId,
          goal,
          task,
          previousStatus: existing.status,
          actorMemberId: auth.member.id,
        });
      }
      return { task };
    },
  });

  register({
    method: 'post',
    path: '/questions/:id/answer',
    auth: { kind: 'member' },
    schema: { body: AnswerBodySchema },
    error: goalError,
    handler: async (req, { authState, reply }) => {
      const auth = authState as AuthedMember;
      if (!requireQuestionAccess(deps, reply, auth.user.organizationId, req.params.id, auth.member.id)) return;
      return {
        question: await deps.goals.answer(auth.user.organizationId, req.params.id, req.body.selectedOption),
      };
    },
  });

  register({
    method: 'post',
    path: '/questions/:id/supersede',
    auth: { kind: 'member' },
    error: goalError,
    handler: async (req, { authState, reply }) => {
      const auth = authState as AuthedMember;
      if (!requireQuestionAccess(deps, reply, auth.user.organizationId, req.params.id, auth.member.id)) return;
      return {
        question: deps.goals.supersede(auth.user.organizationId, req.params.id),
      };
    },
  });
}