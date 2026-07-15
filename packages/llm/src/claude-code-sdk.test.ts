import { generateText, tool } from 'ai';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createClaudeCodeModel } from './claude-code-sdk.js';

function fakeQuery(
  run: (input: Parameters<typeof query>[0]) => AsyncIterable<Record<string, unknown>>,
) {
  return run as unknown as typeof query;
}

describe('Claude Code SDK model', () => {
  it('maps SDK text and usage into generateText', async () => {
    let request: Parameters<typeof query>[0] | undefined;
    const model = createClaudeCodeModel({
      modelId: 'claude-sonnet',
      queryImpl: fakeQuery((input) => {
        request = input;
        return (async function* () {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'pong' }] } };
          yield {
            type: 'result',
            is_error: false,
            result: 'pong',
            usage: { input_tokens: 3, output_tokens: 2 },
          };
        })();
      }),
    });

    const result = await generateText({ model, system: 'Be concise.', prompt: 'ping' });

    expect(result.text).toBe('pong');
    expect(result.usage.totalTokens).toBe(5);
    expect(request?.prompt).toContain('USER:\nping');
    expect(request?.options?.systemPrompt).toBe('Be concise.');
  });

  it('executes AI SDK tools through the Claude MCP bridge', async () => {
    let executed: unknown;
    const model = createClaudeCodeModel({
      modelId: 'claude-sonnet',
      toolExecutor: async (name, args, toolCallId) => {
        executed = { name, args, toolCallId };
        return { ok: true };
      },
      queryImpl: fakeQuery((input) => {
        return (async function* () {
          const server = (input.options?.mcpServers as Record<string, { instance?: { _registeredTools?: Record<string, { handler: Function }> } }> | undefined)?.ujima?.instance;
          const toolHandler = server?._registeredTools?.ping?.handler;
          if (!toolHandler) throw new Error('MCP tool was not registered');
          const toolResult = await toolHandler({ value: 'x' }, { toolUseId: 'call-1' });
          yield {
            type: 'assistant',
            message: { content: [{ type: 'tool_use', id: 'call-1', name: 'mcp__ujima__ping', input: { value: 'x' } }] },
          };
          yield {
            type: 'user',
            message: { content: [{ type: 'tool_result', tool_use_id: 'call-1', content: toolResult.content }] },
          };
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } };
          yield { type: 'result', is_error: false, result: 'done', usage: { input_tokens: 5, output_tokens: 4 } };
        })();
      }),
    });

    const result = await generateText({
      model,
      prompt: 'run it',
      tools: { ping: tool({ inputSchema: z.object({ value: z.string() }) }) },
    });

    expect(executed).toEqual({ name: 'ping', args: { value: 'x' }, toolCallId: 'call-1' });
    expect(result.text).toBe('done');
    expect(result.toolCalls[0]?.toolName).toBe('ping');
    expect(result.toolResults[0]?.toolName).toBe('ping');
  });
});
