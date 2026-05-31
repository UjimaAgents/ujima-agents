import { z } from 'zod';
import { GoalTaskStatusSchema } from '@ujima/shared';
import { QUESTION_RECOMMENDED_SUFFIX } from '../services/goal-system.js';
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
  status: GoalTaskStatusSchema,
  handover_summary: z.string().min(1).optional(),
});

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
    return ctx.goals.start({
      organizationId: ctx.invocation.organizationId,
      channelId: invocationChannelId(ctx),
      supervisorId: ctx.invocation.memberId,
      title: input.title,
      planMarkdown: input.plan_markdown,
      tasks: input.tasks.map((task) => ({
        title: task.title,
        assigneeId: task.assignee_id,
        dependsOnTaskIndex: task.depends_on_task_index,
      })),
    });
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
    });
  },
};
