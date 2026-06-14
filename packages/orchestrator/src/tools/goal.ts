import { z } from 'zod';
import { GoalTaskStatusSchema } from '@ujima/shared';
import {
  IMPLEMENT_QUESTION_OPTION,
  IMPLEMENT_QUESTION_REJECT_OPTION,
  IMPLEMENT_QUESTION_TEXT,
  QUESTION_RECOMMENDED_SUFFIX,
} from '../services/goal-system.js';
import type { ToolExecutionContext, OrchestratorTool } from './types.js';

const goalStartSchema = (assigneeIdSchema: z.ZodType<string> = z.string().min(1)) => z.object({
  title: z.string().min(1),
  plan_markdown: z.string().min(1),
  tasks: z.array(z.object({
    title: z.string().min(1),
    assignee_id: assigneeIdSchema,
    depends_on_task_index: z.number().int().nonnegative().optional(),
  })).min(1),
});
const GoalStartSchema = goalStartSchema();

const QuestionAskSchema = z.object({
  goal_id: z.string().min(1).optional(),
  question_text: z.string().min(1),
  options: z.array(z.string().min(1))
    .min(2)
    .refine((options) => new Set(options).size === options.length, 'options must be unique')
    .refine(
      (options) => options.filter((option) => option.endsWith(QUESTION_RECOMMENDED_SUFFIX)).length === 1,
      `exactly one option must end with ${QUESTION_RECOMMENDED_SUFFIX}`,
    ),
});

const GoalTaskUpdateSchema = z.object({
  task_id: z.string().min(1),
  // All edit fields are optional. Anyone may set `status` /
  // `handover_summary`; `title` / `description` / `assignee_id`
  // require the caller to be the goal's supervisor (enforced in
  // GoalSystemService.updateTask). At least one field must be set
  // — refined below.
  status: GoalTaskStatusSchema.optional(),
  handover_summary: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  assignee_id: z.string().min(1).optional(),
}).refine(
  (v) =>
    v.status !== undefined ||
    v.handover_summary !== undefined ||
    v.title !== undefined ||
    v.description !== undefined ||
    v.assignee_id !== undefined,
  { message: 'goal_task_update requires at least one field to change' },
);

function invocationChannelId(ctx: ToolExecutionContext): string {
  const threadId = ctx.invocation.threadId;
  if (!threadId) throw new Error('threadId is required');
  const channelId = ctx.repo.getThread(ctx.invocation.organizationId, threadId)?.channelId;
  if (!channelId) throw new Error('channelId is required');
  return channelId;
}

export const goalStartTool: OrchestratorTool<typeof GoalStartSchema> = {
  id: 'goal.start',
  schema: GoalStartSchema,
  buildSchema: (ctx) => {
    const memberIds = new Set(ctx.repo.listMembers(ctx.organizationId).map((member) => member.id));
    return goalStartSchema(z.string().min(1).refine((id) => memberIds.has(id), 'assignee_id must be a member id'));
  },
  toInvocation: (args) => ({
    action: 'create',
    resourceType: 'goal',
    input: args,
    bypassPermission: true,
  }),
  execute: (ctx) => {
    const input = ctx.invocation.input as z.infer<typeof GoalStartSchema>;
    const runId = ctx.invocation.runId;
    const channelId = invocationChannelId(ctx);
    if (runId) {
      const existingQuestions = ctx.repo.listInteractiveQuestionsByRunId?.(ctx.invocation.organizationId, runId) ?? [];
      const implementQuestions = existingQuestions.filter(
        (question) => question.questionText === IMPLEMENT_QUESTION_TEXT,
      );
      const implementQuestion =
        implementQuestions.find((question) => question.status === 'pending') ??
        [...implementQuestions]
          .reverse()
          .find((question) => question.status === 'answered');
      if (implementQuestion?.status === 'answered') {
        const existingStep = ctx.repo
          .listRunSteps(ctx.invocation.organizationId, runId)
          .find((step) => step.toolCallId === implementQuestion.toolCallId);
        const carry =
          existingStep?.output && typeof existingStep.output === 'object'
            ? (existingStep.output as Record<string, unknown>)
            : {};
        const { status: _staleStatus, questionId: _staleQuestionId, ...rest } = carry;
        return {
          ...rest,
          status: 'completed',
          selectedOption: implementQuestion.selectedOption,
        };
      }
      if (implementQuestion?.status === 'pending') {
        return { status: 'waiting_for_input', questionId: implementQuestion.id };
      }
    }

    const channel = ctx.repo.getChannel(ctx.invocation.organizationId, channelId);
    const activeGoal =
      channel?.kind === 'dm' || channel?.kind === 'self'
        ? ctx.repo.getGoalByChannel(ctx.invocation.organizationId, channelId)
        : null;
    if (activeGoal?.status === 'running') {
      return {
        status: 'completed',
        selectedOption: IMPLEMENT_QUESTION_OPTION,
        goal: activeGoal,
        tasks: ctx.repo.listGoalTasks(ctx.invocation.organizationId, activeGoal.id),
      };
    }

    const result = ctx.goals.start({
      organizationId: ctx.invocation.organizationId,
      channelId,
      supervisorId: ctx.invocation.memberId,
      title: input.title,
      planMarkdown: input.plan_markdown,
      tasks: input.tasks.map((task) => ({
        title: task.title,
        assigneeId: task.assignee_id,
        dependsOnTaskIndex: task.depends_on_task_index,
      })),
    });
    if (!runId) return result;

    const question = ctx.goals.ask({
      organizationId: ctx.invocation.organizationId,
      channelId: result.goal.channelId,
      goalId: result.goal.id,
      runId,
      toolCallId: ctx.invocation.toolCallId,
      questionText: IMPLEMENT_QUESTION_TEXT,
      options: [IMPLEMENT_QUESTION_OPTION, IMPLEMENT_QUESTION_REJECT_OPTION],
    });
    const run = ctx.repo.getRun(ctx.invocation.organizationId, runId);
    if (run) {
      ctx.repo.saveRun({
        ...run,
        status: 'waiting_for_input',
        step: 'waiting_for_input',
        summary: question.questionText,
      });
    }
    return { status: 'waiting_for_input', questionId: question.id, goal: result.goal, tasks: result.tasks };
  },
};

export const questionAskTool: OrchestratorTool<typeof QuestionAskSchema> = {
  id: 'question.ask',
  schema: QuestionAskSchema,
  toInvocation: (args) => ({
    action: 'create',
    resourceType: 'question',
    input: args,
    bypassPermission: true,
  }),
  execute: (ctx) => {
    const input = ctx.invocation.input as z.infer<typeof QuestionAskSchema>;
    const runId = ctx.invocation.runId;

    if (runId) {
      const existingQuestions = ctx.repo.listInteractiveQuestionsByRunId?.(ctx.invocation.organizationId, runId) ?? [];
      const matching = existingQuestions.find((q) => q.toolCallId === ctx.invocation.toolCallId);
      const answered = matching?.status === 'answered' ? matching : null;
      if (answered) {
        return { status: 'completed', selectedOption: answered.selectedOption };
      }
      const pending = matching?.status === 'pending' ? matching : null;
      if (pending) {
        return { status: 'waiting_for_input', questionId: pending.id };
      }
    }

    const question = ctx.goals.ask({
      organizationId: ctx.invocation.organizationId,
      channelId: invocationChannelId(ctx),
      goalId: input.goal_id,
      runId,
      toolCallId: ctx.invocation.toolCallId,
      questionText: input.question_text,
      options: input.options,
    });
    const run = runId ? ctx.repo.getRun(ctx.invocation.organizationId, runId) : null;
    if (run) {
      ctx.repo.saveRun({
        ...run,
        status: 'waiting_for_input',
        step: 'waiting_for_input',
        summary: question.questionText,
      });
    }
    return { status: 'waiting_for_input', questionId: question.id };
  },
};

export const goalTaskUpdateTool: OrchestratorTool<typeof GoalTaskUpdateSchema> = {
  id: 'goal.task.update',
  schema: GoalTaskUpdateSchema,
  toInvocation: (args) => ({
    action: 'update',
    resourceType: 'goal_task',
    resourcePath: args.task_id,
    input: args,
    bypassPermission: true,
  }),
  execute: (ctx) => {
    const input = ctx.invocation.input as z.infer<typeof GoalTaskUpdateSchema>;
    return ctx.goals.updateTask({
      organizationId: ctx.invocation.organizationId,
      taskId: input.task_id,
      status: input.status,
      handoverSummary: input.handover_summary,
      title: input.title,
      description: input.description,
      assigneeId: input.assignee_id,
      callerMemberId: ctx.invocation.memberId,
    });
  },
};
