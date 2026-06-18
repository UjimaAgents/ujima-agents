import type { RunState, Spirit, SpiritRole, WakeReason } from '@ujima/shared';
import { goalModeSystemPromptSuffix } from './goal-mode-prompt.js';
import { scheduleToolSystemPromptSuffix } from './schedule-prompt.js';

export function runWakeReason(run: Pick<RunState, 'wakeReason'>): WakeReason | null {
  return run.wakeReason == null ? null : (run.wakeReason as WakeReason);
}

export function composeSystemPromptSuffix(input: {
  extraSuffix?: string;
  messageContent?: string | null;
  goalMode?: boolean;
  scheduleMode?: boolean;
}): string | undefined {
  const segments = [
    input.extraSuffix,
    goalModeSystemPromptSuffix({
      goalMode: input.goalMode,
      messageContent: input.messageContent,
    }),
    scheduleToolSystemPromptSuffix({
      messageContent: input.messageContent,
      scheduleMode: input.scheduleMode,
    }),
  ].filter((segment): segment is string => Boolean(segment));
  return segments.length > 0 ? segments.join('\n\n') : undefined;
}
import { defaultResolveModelId } from '../utils/to-model-messages.js';
import type { RunDetailAggregate } from './spirit-types.js';

export const TERMINAL_TASK_SESSION_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export function deriveTaskSessionOutcome(
  workers: readonly Spirit[],
): 'completed' | 'failed' | 'cancelled' {
  if (workers.some((spirit) => spirit.status === 'failed')) {
    return 'failed';
  }
  if (workers.every((spirit) => spirit.status === 'completed')) {
    return 'completed';
  }
  return 'cancelled';
}

export function pickProviderModel(input: {
  teamRole: { model?: string };
  provider: { defaultModel?: string };
  role: SpiritRole;
}): string | undefined {
  return defaultResolveModelId(
    input.teamRole,
    input.provider as { defaultModel?: string; supervisorModel?: string; supervisor_model?: string },
    input.role,
  );
}

export function isToolCardError(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const value = result as { error?: unknown; status?: unknown; isError?: unknown };
  return value.isError === true || typeof value.error === 'string' || value.status === 'blocked';
}

export function aggregateToolUsage(
  messages: readonly { toolCalls?: readonly { toolName?: string; result?: unknown }[] }[],
): Record<string, RunDetailAggregate> {
  const tools: Record<string, RunDetailAggregate> = {};
  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      const toolName = toolCall.toolName ?? 'unknown';
      const current = tools[toolName] ?? { count: 0, pending: 0 };
      current.count += 1;
      const output = toolCall.result as { status?: string } | undefined;
      if (output?.status && output.status !== 'completed') {
        current.pending += 1;
      }
      tools[toolName] = current;
    }
  }
  return tools;
}
