import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  GoalBoardCreatedCardSchema,
  GoalSchema,
  GoalTaskSchema,
  GoalTaskStatusSchema,
  GoalTaskUpdatedCardSchema,
  goalTaskColumnLabel,
  type Goal,
  type GoalTask,
  type GoalTaskStatus,
  type MessageCard,
  type MessageToolCall,
} from '@ujima/shared';
import { buildSystemCardMessage } from './message-factory.js';
import { publishStoredMessage } from './message-publisher.js';
import type { ConversationService } from './conversation.js';
import { normalizeToDottedToolName } from './run-reply-guard.js';

interface ToolCallLike {
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  input?: unknown;
}

interface ToolResultLike {
  toolCallId?: string;
  output?: unknown;
  result?: unknown;
}

const GoalTaskUpdateResultSchema = GoalTaskSchema.extend({
  previousStatus: GoalTaskStatusSchema.optional(),
  actorMemberId: z.string().min(1).optional(),
});

export function appendGoalTaskToolCalls(
  toolCalls: readonly ToolCallLike[],
  toolResults: readonly ToolResultLike[] = [],
): MessageToolCall[] {
  const resultsById = new Map<string, unknown>();
  for (const result of toolResults) {
    if (typeof result.toolCallId !== 'string') continue;
    resultsById.set(result.toolCallId, result.output ?? result.result);
  }

  const cards: MessageToolCall[] = [];
  for (const call of toolCalls) {
    const toolName = normalizeToDottedToolName(call.toolName?.toLowerCase() ?? '');
    const output = call.toolCallId ? resultsById.get(call.toolCallId) : undefined;
    if (toolName === 'goal.start') {
      const card = buildGoalBoardCreatedCard(output);
      if (card) {
        cards.push(wrapGoalCard('card.goal.board.created', card));
      }
    } else if (toolName === 'goal.task.update') {
      const card = buildGoalTaskUpdatedCard(output);
      if (card) {
        cards.push(wrapGoalCard('card.goal.task.updated', card));
      }
    }
  }
  return cards;
}

export function buildGoalBoardCreatedCard(output: unknown): MessageCard | undefined {
  if (!isRecord(output)) return undefined;
  const goal = GoalSchema.safeParse(output.goal);
  const tasks = GoalTaskSchema.array().safeParse(output.tasks);
  if (!goal.success || !tasks.success || tasks.data.length === 0) return undefined;

  const card = GoalBoardCreatedCardSchema.parse({
    cardId: randomUUID(),
    kind: 'goal.board.created',
    goalId: goal.data.id,
    goalTitle: goal.data.title,
    goalStatus: goal.data.status,
    channelId: goal.data.channelId,
    tasks: tasks.data.map((task) => ({
      id: task.id,
      title: task.title,
      assigneeId: task.assigneeId,
      status: task.status,
      ...(task.dependsOnTaskId ? { dependsOnTaskId: task.dependsOnTaskId } : {}),
    })),
  });
  return card;
}

export function buildGoalTaskUpdatedCard(output: unknown): MessageCard | undefined {
  const parsed = GoalTaskUpdateResultSchema.safeParse(output);
  if (!parsed.success) return undefined;
  const task = parsed.data;
  if (!task.previousStatus || task.previousStatus === task.status) return undefined;

  const card = GoalTaskUpdatedCardSchema.parse({
    cardId: randomUUID(),
    kind: 'goal.task.updated',
    goalId: task.goalId,
    taskId: task.id,
    taskTitle: task.title,
    assigneeId: task.assigneeId,
    previousStatus: task.previousStatus,
    status: task.status,
    ...(task.handoverSummary ? { handoverSummary: task.handoverSummary } : {}),
    ...(task.actorMemberId ? { actorMemberId: task.actorMemberId } : {}),
  });
  return card;
}

export function buildGoalTaskUpdatedCardFromTask(input: {
  task: GoalTask;
  previousStatus: GoalTaskStatus;
  actorMemberId?: string;
}): MessageCard {
  return GoalTaskUpdatedCardSchema.parse({
    cardId: randomUUID(),
    kind: 'goal.task.updated',
    goalId: input.task.goalId,
    taskId: input.task.id,
    taskTitle: input.task.title,
    assigneeId: input.task.assigneeId,
    previousStatus: input.previousStatus,
    status: input.task.status,
    ...(input.task.handoverSummary ? { handoverSummary: input.task.handoverSummary } : {}),
    ...(input.actorMemberId ? { actorMemberId: input.actorMemberId } : {}),
  });
}

export function publishGoalTaskUpdatedCard(input: {
  conversations: ConversationService;
  organizationId: string;
  goal: Goal;
  task: GoalTask;
  previousStatus: GoalTaskStatus;
  actorMemberId: string;
}): void {
  const card = buildGoalTaskUpdatedCardFromTask({
    task: input.task,
    previousStatus: input.previousStatus,
    actorMemberId: input.actorMemberId,
  });
  const fromLabel = goalTaskColumnLabel(input.previousStatus);
  const toLabel = goalTaskColumnLabel(input.task.status);
  publishStoredMessage({
    conversations: input.conversations,
    message: buildSystemCardMessage({
      organizationId: input.organizationId,
      threadId: input.goal.channelId,
      channelId: input.goal.channelId,
      content: `Task "${input.task.title}" moved from ${fromLabel} → ${toLabel}`,
      card,
    }),
  });
}

function wrapGoalCard(toolName: string, card: MessageCard): MessageToolCall {
  return {
    toolCallId: randomUUID(),
    toolName,
    args: { ...card },
    result: card,
    isError: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
