import { z } from 'zod';
import { GoalTaskStatusSchema } from '@ujima/shared';
import {
  IMPLEMENT_QUESTION_OPTION,
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
    if (runId) {
      const existingQuestions = ctx.repo.listInteractiveQuestionsByRunId?.(ctx.invocation.organizationId, runId) ?? [];
      const matching = existingQuestions.find((q) => q.toolCallId === ctx.invocation.toolCallId);
      if (matching?.status === 'answered') {
        // Resume after the implement-question was answered. Re-read
        // the goal + tasks from the previous step's output and
        // explicitly omit `status` and `questionId` before applying
        // the answered shape. The earlier spread-then-override
        // pattern leaked a stale `questionId` from the
        // waiting_for_input step; the model then read that dangling
        // `questionId` as "tool is still asking" and hallucinated
        // an "interactive user input required" error even though
        // the override flipped status to 'completed'. Stripping the
        // two contradictory fields removes the ambiguity.
        const existingStep = ctx.repo
          .listRunSteps(ctx.invocation.organizationId, runId)
          .find((step) => step.toolCallId === ctx.invocation.toolCallId);
        const carry =
          existingStep?.output && typeof existingStep.output === 'object'
            ? (existingStep.output as Record<string, unknown>)
            : {};
        const { status: _staleStatus, questionId: _staleQuestionId, ...rest } = carry;
        return {
          ...rest,
          status: 'completed',
          selectedOption: matching.selectedOption,
        };
      }
      if (matching?.status === 'pending') {
        return { status: 'waiting_for_input', questionId: matching.id };
      }
      // Same-run, different toolCallId dedup. The model occasionally
      // retries goal.start within a few hundred ms (different
      // toolCallId so the (runId, toolCallId) check above doesn't
      // fire). The second call's create-or-replace path runs
      // `supersede pending questions for this channel` — which
      // includes the FIRST call's own question, orphaning the
      // originating run in waiting_for_input forever. Detect the
      // duplicate by looking for any pending question this run has
      // already raised in this channel and return its id instead of
      // creating a fresh goal + question pair.
      const channelId = invocationChannelId(ctx);
      const pendingForChannel = ctx.repo.listPendingInteractiveQuestions?.(
        ctx.invocation.organizationId,
        channelId,
      ) ?? [];
      const ownPending = pendingForChannel.find((q) => q.runId === runId);
      if (ownPending) {
        return { status: 'waiting_for_input', questionId: ownPending.id };
      }
    }

    const result = ctx.goals.start({
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
    if (!runId) return result;

    const memberName = ctx.repo.getMember(ctx.invocation.organizationId, ctx.invocation.memberId)?.name ?? ctx.invocation.memberId;
    const question = ctx.goals.ask({
      organizationId: ctx.invocation.organizationId,
      channelId: result.goal.channelId,
      goalId: result.goal.id,
      runId,
      toolCallId: ctx.invocation.toolCallId,
      questionText: IMPLEMENT_QUESTION_TEXT,
      options: [IMPLEMENT_QUESTION_OPTION, `Tell ${memberName} to do something different`],
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
