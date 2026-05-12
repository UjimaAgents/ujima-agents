import { describe, expect, test } from 'vitest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { AuditLog } from '@ujima/context-store';
import type { MCPConnection, ToolInfo } from '@ujima/mcp-client';
import type { PermissionMiddleware } from '@ujima/permissions';
import type { AgentDef } from '@ujima/shared';
import { runAiSdkLoop } from './ai-sdk-loop';

// -------------------------------------------------------------------
// Minimal fixtures for the loop's dependencies. We deliberately avoid
// @ujima/context-store + @ujima/permissions real implementations because
// this is a smoke test for the E0 shell dispatch / permission pre-hook /
// approval gate / usage capture contract — not an end-to-end run.
// -------------------------------------------------------------------

const agent: AgentDef = {
  id: 'agent-alex',
  name: 'Alex',
  persona: 'backend-engineer',
  model: 'claude-opus-4-7',
  mcp: 'filesystem',
  permissions: {
    allowed_tools: ['read_file', 'write_file'],
    blocked_tools: [],
    rate_limit: { calls_per_minute: 30, max_session_tokens: 100_000 },
  },
  communication: { publishes: [], subscribes: [] },
  escalation: { conditions: [], escalate_to: 'human' },
};

function makeMcp(): MCPConnection {
  const tools: ToolInfo[] = [
    { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
    { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object' } },
  ];
  return {
    id: 'filesystem',
    def: { id: 'filesystem', name: 'filesystem', command: 'x', args: [] },
    listTools: async () => tools,
    callTool: async (_ctx: unknown, name: string, args: Record<string, unknown>) => ({
      isError: false,
      content: `ran ${name} with ${JSON.stringify(args)}`,
    }),
    close: async () => undefined,
  } as unknown as MCPConnection;
}

const fakeAudit = { write: async () => undefined } as unknown as AuditLog;

function fakePermissions(
  decisions: Map<string, { allowed: boolean; code?: string; reason?: string; gate?: string; rule?: string }>,
) {
  const usage: number[] = [];
  return {
    middleware: {
      check: async ({ toolName }: { toolName: string }) => {
        const d = decisions.get(toolName) ?? { allowed: true };
        return {
          allowed: d.allowed,
          code: d.code,
          reason: d.reason,
          gate: d.gate,
          rule: d.rule,
        };
      },
      recordUsage: async (_id: string, tokens: number) => {
        usage.push(tokens);
      },
    } as unknown as PermissionMiddleware,
    usage,
  };
}

// LanguageModelV3Usage shape is nested (`inputTokens: { total, noCache, ... }`).
// Helper to keep the stream fixtures readable.
function v3Usage(inputTotal: number, outputTotal: number) {
  return {
    inputTokens: { total: inputTotal, noCache: inputTotal, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTotal, text: outputTotal, reasoning: 0 },
    totalTokens: inputTotal + outputTotal,
  };
}

function makeModelWith(parts: LanguageModelV3StreamPart[]) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({ chunks: parts }),
    }),
  });
}

describe('runAiSdkLoop', () => {
  test('completed: text turn with no tool calls captures usage + finalText', async () => {
    const model = makeModelWith([
      { type: 'text-start', id: '1' },
      { type: 'text-delta', id: '1', delta: 'Hello ' },
      { type: 'text-delta', id: '1', delta: 'world.' },
      { type: 'text-end', id: '1' },
      {
        type: 'finish',
        usage: v3Usage(42, 7),
        finishReason: { unified: 'stop' as const, raw: 'stop' },
      },
    ]);

    const { middleware, usage } = fakePermissions(new Map());

    const outcome = await runAiSdkLoop({
      agent,
      taskId: 'task-1',
      sessionId: 'session-1',
      model,
      mcp: makeMcp(),
      tools: await makeMcp().listTools(),
      permissions: middleware,
      audit: fakeAudit,
      systemPrompt: 'You are a backend engineer.',
      userPrompt: 'Say hi.',
      maxIterations: 3,
    });

    expect(outcome.exitReason).toBe('completed');
    expect(outcome.finalText).toBe('Hello world.');
    expect(outcome.usage.inputTokens).toBe(42);
    expect(outcome.usage.outputTokens).toBe(7);
    expect(outcome.tokensUsed).toBe(49);
    expect(outcome.toolCalls).toBe(0);
    expect(usage).toEqual([49]); // permissions.recordUsage called once with total
  });

  test('permission pre-hook: denied tool returns structured error, loop still completes', async () => {
    // Two-step response: first step attempts write_file → denied → model
    // receives structured error and finishes in the second step.
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        const hasToolResults = options.prompt.some((m) =>
          Array.isArray(m.content)
            ? m.content.some((c: { type?: string }) => c.type === 'tool-result')
            : false,
        );
        if (!hasToolResults) {
          return {
            stream: simulateReadableStream<LanguageModelV3StreamPart>({
              chunks: [
                { type: 'text-start', id: '1' },
                { type: 'text-delta', id: '1', delta: 'Writing file…' },
                { type: 'text-end', id: '1' },
                {
                  type: 'tool-call',
                  toolCallId: 'call-1',
                  toolName: 'write_file',
                  input: JSON.stringify({ path: '/etc/passwd', contents: 'owned' }),
                },
                {
                  type: 'finish',
                  usage: v3Usage(20, 10),
                  finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
                },
              ],
            }),
          };
        }
        return {
          stream: simulateReadableStream<LanguageModelV3StreamPart>({
            chunks: [
              { type: 'text-start', id: '2' },
              { type: 'text-delta', id: '2', delta: "I can't write that file." },
              { type: 'text-end', id: '2' },
              {
                type: 'finish',
                usage: v3Usage(25, 8),
                finishReason: { unified: 'stop' as const, raw: 'stop' },
              },
            ],
          }),
        };
      },
    });

    const { middleware } = fakePermissions(
      new Map([
        ['write_file', { allowed: false, code: 'path_outside_scope', reason: '/etc/passwd is outside workspace' }],
      ]),
    );

    const outcome = await runAiSdkLoop({
      agent,
      taskId: 'task-2',
      sessionId: 'session-2',
      model,
      mcp: makeMcp(),
      tools: await makeMcp().listTools(),
      permissions: middleware,
      audit: fakeAudit,
      systemPrompt: 'You are a backend engineer.',
      userPrompt: 'Write /etc/passwd.',
      maxIterations: 3,
    });

    expect(outcome.exitReason).toBe('completed');
    expect(outcome.finalText).toBe("I can't write that file.");
    expect(outcome.toolCalls).toBe(1); // attempted once
    expect(outcome.iterations).toBe(2);
  });

  test('approval gate: reject returns rejection text to the model; run still completes', async () => {
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        const hasToolResults = options.prompt.some((m) =>
          Array.isArray(m.content)
            ? m.content.some((c: { type?: string }) => c.type === 'tool-result')
            : false,
        );
        if (!hasToolResults) {
          return {
            stream: simulateReadableStream<LanguageModelV3StreamPart>({
              chunks: [
                { type: 'text-start', id: '1' },
                { type: 'text-end', id: '1' },
                {
                  type: 'tool-call',
                  toolCallId: 'call-1',
                  toolName: 'write_file',
                  input: JSON.stringify({ path: 'src/index.ts' }),
                },
                {
                  type: 'finish',
                  usage: v3Usage(10, 5),
                  finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
                },
              ],
            }),
          };
        }
        return {
          stream: simulateReadableStream<LanguageModelV3StreamPart>({
            chunks: [
              { type: 'text-start', id: '2' },
              { type: 'text-delta', id: '2', delta: 'Got it, the human rejected.' },
              { type: 'text-end', id: '2' },
              {
                type: 'finish',
                usage: v3Usage(12, 6),
                finishReason: { unified: 'stop' as const, raw: 'stop' },
              },
            ],
          }),
        };
      },
    });

    const { middleware } = fakePermissions(
      new Map([
        [
          'write_file',
          {
            allowed: false,
            code: 'requires_approval',
            reason: 'writes always require approval',
            gate: 'approval',
          },
        ],
      ]),
    );

    let gateCalls = 0;
    const outcome = await runAiSdkLoop({
      agent,
      taskId: 'task-3',
      sessionId: 'session-3',
      model,
      mcp: makeMcp(),
      tools: await makeMcp().listTools(),
      permissions: middleware,
      audit: fakeAudit,
      systemPrompt: 'You are a backend engineer.',
      userPrompt: 'Write src/index.ts.',
      maxIterations: 3,
      gateResolver: {
        awaitDecision: async () => {
          gateCalls++;
          return { kind: 'reject', reason: 'not yet' };
        },
      },
    });

    expect(gateCalls).toBe(1);
    expect(outcome.exitReason).toBe('completed');
    expect(outcome.finalText).toContain('rejected');
  });
});
