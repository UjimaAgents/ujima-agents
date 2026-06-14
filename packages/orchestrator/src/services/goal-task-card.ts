import { randomUUID } from 'node:crypto';
import {
  GoalBoardCreatedCardSchema,
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
    const toolName = call.toolName?.toLowerCase();
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
  const goal = readGoal(output.goal);
  const tasks = readGoalTasks(output.tasks);
  if (!goal || tasks.length === 0) return undefined;

  const card = GoalBoardCreatedCardSchema.parse({
    cardId: randomUUID(),
    kind: 'goal.board.created',
    goalId: goal.id,
    goalTitle: goal.title,
    goalStatus: goal.status,
    channelId: goal.channelId,
    tasks: tasks.map((task) => ({
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
  if (!isRecord(output)) return undefined;
  const task = readGoalTask(output);
  if (!task) return undefined;

  const previousStatus = readGoalTaskStatus(output.previousStatus);
  if (!previousStatus || previousStatus === task.status) return undefined;

  const card = GoalTaskUpdatedCardSchema.parse({
    cardId: randomUUID(),
    kind: 'goal.task.updated',
    goalId: task.goalId,
    taskId: task.id,
    taskTitle: task.title,
    assigneeId: task.assigneeId,
    previousStatus,
    status: task.status,
    ...(task.handoverSummary ? { handoverSummary: task.handoverSummary } : {}),
    ...(typeof output.actorMemberId === 'string' ? { actorMemberId: output.actorMemberId } : {}),
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
    args: card as unknown as Record<string, unknown>,
    result: card,
    isError: false,
  };
}

function readGoal(value: unknown): Goal | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return undefined;
  if (typeof value.status !== 'string' || typeof value.channelId !== 'string') return undefined;
  return value as Goal;
}

function readGoalTask(value: unknown): GoalTask | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== 'string' || typeof value.goalId !== 'string') return undefined;
  if (typeof value.title !== 'string' || typeof value.assigneeId !== 'string') return undefined;
  if (typeof value.status !== 'string') return undefined;
  return value as GoalTask;
}

function readGoalTasks(value: unknown): GoalTask[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const task = readGoalTask(entry);
    return task ? [task] : [];
  });
}

function readGoalTaskStatus(value: unknown): GoalTaskStatus | undefined {
  if (typeof value !== 'string') return undefined;
  return value as GoalTaskStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
