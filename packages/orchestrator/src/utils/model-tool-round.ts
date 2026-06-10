import type { MessageToolCall } from '@ujima/shared';
import type { AssistantContent, ModelMessage, ToolResultPart } from 'ai';
import { toModelToolName } from '../tools/names.js';

type ToolResultOutput = ToolResultPart['output'];

export interface ToolRoundCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
}

export function toToolResultOutput(result: unknown, isError: boolean): ToolResultOutput {
  if (isError) {
    const value =
      typeof result === 'string'
        ? result
        : result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
          ? result.error
          : JSON.stringify(result ?? { error: 'tool failed' });
    return { type: 'error-text', value };
  }
  if (result && typeof result === 'object') {
    return {
      type: 'json',
      value: result as Extract<ToolResultOutput, { type: 'json' }>['value'],
    };
  }
  return { type: 'text', value: String(result ?? '') };
}

export function resolveToolCallPayload(call: MessageToolCall): {
  args: Record<string, unknown>;
  result: unknown;
  isError: boolean;
} {
  const card =
    call.result && typeof call.result === 'object' && (call.result as { kind?: unknown }).kind === 'tool.call'
      ? (call.result as { args?: Record<string, unknown>; result?: unknown; isError?: boolean })
      : undefined;
  return {
    args: card?.args ?? call.args,
    result: card?.result ?? call.result,
    isError: card?.isError ?? call.isError,
  };
}

export function buildAssistantToolRoundMessages(input: {
  text?: string;
  reasoning?: string;
  toolCalls: ToolRoundCall[];
  /** One assistant+tool pair per call (run-step resume) vs one combined round (thread history). */
  splitPerCall?: boolean;
}): ModelMessage[] {
  if (!input.toolCalls.length) return [];
  if (input.splitPerCall) {
    return input.toolCalls.flatMap((call) =>
      buildSingleToolRoundMessages(call, { text: input.text, reasoning: input.reasoning }),
    );
  }

  const parts: AssistantContent = [];
  if (input.reasoning?.trim()) parts.push({ type: 'reasoning', text: input.reasoning.trim() });
  if (input.text?.trim()) parts.push({ type: 'text', text: input.text.trim() });
  for (const call of input.toolCalls) {
    parts.push({
      type: 'tool-call',
      toolCallId: call.toolCallId,
      toolName: toModelToolName(call.toolName),
      input: call.args,
    });
  }
  const out: ModelMessage[] = [{ role: 'assistant', content: parts }];
  const completed = input.toolCalls.filter((call) => call.result !== undefined);
  if (completed.length > 0) {
    out.push({
      role: 'tool',
      content: completed.map((call) => ({
        type: 'tool-result',
        toolCallId: call.toolCallId,
        toolName: toModelToolName(call.toolName),
        output: toToolResultOutput(call.result, call.isError ?? false),
      })),
    });
  }
  return out;
}

function buildSingleToolRoundMessages(
  call: ToolRoundCall,
  preamble?: { text?: string; reasoning?: string },
): ModelMessage[] {
  const parts: AssistantContent = [];
  if (preamble?.reasoning?.trim()) parts.push({ type: 'reasoning', text: preamble.reasoning.trim() });
  if (preamble?.text?.trim()) parts.push({ type: 'text', text: preamble.text.trim() });
  parts.push({
    type: 'tool-call',
    toolCallId: call.toolCallId,
    toolName: toModelToolName(call.toolName),
    input: call.args,
  });
  const out: ModelMessage[] = [{ role: 'assistant', content: parts }];
  if (call.result !== undefined) {
    out.push({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: call.toolCallId,
          toolName: toModelToolName(call.toolName),
          output: toToolResultOutput(call.result, call.isError ?? false),
        },
      ],
    });
  }
  return out;
}
