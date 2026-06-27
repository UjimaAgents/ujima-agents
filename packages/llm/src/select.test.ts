import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonSchema, stepCountIs, streamText } from 'ai';
import { setCodexAppServerSpawn } from './codex-app-server.js';
import { selectLanguageModel } from './select.js';

function createFakeAppServer(): {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
  on: typeof EventEmitter.prototype.on;
  requests: unknown[];
} {
  const child = new EventEmitter() as unknown as {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
    on: typeof EventEmitter.prototype.on;
    requests: unknown[];
  };
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = new PassThrough();
  child.requests = [];
  child.kill = vi.fn(() => true) as never;

  let buffer = '';
  let loopTurns = 0;
  stdin.on('data', (chunk) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line) continue;
      const msg = JSON.parse(line) as { id?: number; method?: string; params?: unknown };
      child.requests.push(msg);
      if (msg.method === 'initialize') {
        stdout.write(`${JSON.stringify({ id: msg.id, result: { platformFamily: 'darwin', platformOs: 'macos' } })}\n`);
        continue;
      }
      if (msg.method === 'thread/start') {
        stdout.write(`${JSON.stringify({ id: msg.id, result: { thread: { id: 'thr_1' } } })}\n`);
        continue;
      }
      if (msg.method === 'thread/inject_items') {
        stdout.write(`${JSON.stringify({ id: msg.id, result: {} })}\n`);
        continue;
      }
      if (msg.method === 'turn/interrupt') {
        stdout.write(`${JSON.stringify({ id: msg.id, result: {} })}\n`);
        stdout.write(`${JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn_1', status: 'completed' } } })}\n`);
        continue;
      }
      if (msg.method === 'turn/start') {
        const text = (((msg.params as { input?: { text?: string }[] }).input ?? [])[0]?.text) ?? '';
        stdout.write(`${JSON.stringify({ id: msg.id, result: { turn: { id: 'turn_1' } } })}\n`);
        stdout.write(`${JSON.stringify({ method: 'turn/started', params: { turn: { id: 'turn_1', status: 'inProgress', items: [] } } })}\n`);
        if (text === 'six turn loop' || loopTurns > 0) {
          loopTurns += 1;
          if (loopTurns < 6) {
            stdout.write(`${JSON.stringify({
              jsonrpc: '2.0',
              id: 200 + loopTurns,
              method: 'item/tool/call',
              params: {
                threadId: 'thr_1',
                turnId: 'turn_1',
                callId: `loop_${loopTurns}`,
                tool: 'ujima_progress',
                arguments: { turn: loopTurns },
              },
            })}\n`);
            continue;
          }
          stdout.write(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'thr_1', turnId: 'turn_1', itemId: 'msg_a', delta: 'first saved message' } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thr_1', turnId: 'turn_1', item: { type: 'agentMessage', id: 'msg_a', text: 'first saved message', phase: null, memoryCitation: null }, completedAtMs: 1 } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'thr_1', turnId: 'turn_1', itemId: 'msg_b', delta: 'second saved message' } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thr_1', turnId: 'turn_1', item: { type: 'agentMessage', id: 'msg_b', text: 'second saved message', phase: null, memoryCitation: null }, completedAtMs: 2 } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn_1', status: 'completed' } } })}\n`);
          continue;
        }
        if (text === 'call tool') {
          stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: 99,
            method: 'item/tool/call',
            params: {
              threadId: 'thr_1',
              turnId: 'turn_1',
              callId: 'call_1',
              tool: 'ujima_grep',
              arguments: { body: 'hi' },
            },
          })}\n`);
          continue;
        }
        if (text === 'call tools') {
          for (const [id, callId, body] of [
            [99, 'call_1', 'hi'],
            [100, 'call_2', 'bye'],
          ] as const) {
            stdout.write(`${JSON.stringify({
              jsonrpc: '2.0',
              id,
              method: 'item/tool/call',
              params: {
                threadId: 'thr_1',
                turnId: 'turn_1',
                callId,
                tool: 'ujima_grep',
                arguments: { body },
              },
            })}\n`);
          }
          continue;
        }
        if (text === 'native command approval') {
          stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: 120,
            method: 'item/commandExecution/requestApproval',
            params: {
              threadId: 'thr_1',
              turnId: 'turn_1',
              itemId: 'cmd_1',
              command: 'npm test',
              cwd: '/repo',
            },
          })}\n`);
          continue;
        }
        if (text === 'native file change') {
          stdout.write(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thr_1', turnId: 'turn_1', item: { type: 'fileChange', id: 'patch_1', changes: [{ path: 'src/a.ts', kind: { type: 'update', move_path: null }, diff: '--- a/src/a.ts\\n+++ b/src/a.ts\\n@@\\n-old\\n+new' }], status: 'completed' }, completedAtMs: 1 } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn_1', status: 'completed' } } })}\n`);
          continue;
        }
        if (text === 'native file approval edit') {
          stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: 121,
            method: 'item/fileChange/requestApproval',
            params: {
              threadId: 'thr_1',
              turnId: 'turn_1',
              itemId: 'patch_approval_1',
              changes: [{
                path: 'src/a.ts',
                kind: { type: 'update' },
                oldText: 'old',
                newText: 'new',
              }],
            },
          })}\n`);
          continue;
        }
        if (text === 'native file approval patch') {
          stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: 122,
            method: 'item/fileChange/requestApproval',
            params: {
              threadId: 'thr_1',
              turnId: 'turn_1',
              itemId: 'patch_approval_2',
              changes: [{
                path: 'src/a.ts',
                kind: { type: 'update' },
                patch: '*** Begin Patch\\n*** Update File: src/a.ts\\n@@\\n-old\\n+new\\n*** End Patch',
              }],
            },
          })}\n`);
          continue;
        }
        if (text === 'separate messages') {
          stdout.write(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'thr_1', turnId: 'turn_1', itemId: 'msg_a', delta: 'first saved message' } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thr_1', turnId: 'turn_1', item: { type: 'agentMessage', id: 'msg_a', text: 'first saved message', phase: null, memoryCitation: null }, completedAtMs: 1 } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'thr_1', turnId: 'turn_1', itemId: 'msg_b', delta: 'second saved message' } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thr_1', turnId: 'turn_1', item: { type: 'agentMessage', id: 'msg_b', text: 'second saved message', phase: null, memoryCitation: null }, completedAtMs: 2 } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn_1', status: 'completed' } } })}\n`);
          continue;
        }
        if (text === 'separate messages without delta ids') {
          stdout.write(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'thr_1', turnId: 'turn_1', delta: 'first saved message' } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thr_1', turnId: 'turn_1', item: { type: 'agentMessage', id: 'msg_a', text: 'first saved message', phase: null, memoryCitation: null }, completedAtMs: 1 } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'thr_1', turnId: 'turn_1', delta: 'second saved message' } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thr_1', turnId: 'turn_1', item: { type: 'agentMessage', id: 'msg_b', text: 'second saved message', phase: null, memoryCitation: null }, completedAtMs: 2 } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn_1', status: 'completed' } } })}\n`);
          continue;
        }
        if (text === 'fallback text merge') {
          stdout.write(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'thr_1', turnId: 'turn_1', delta: 'first saved message' } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thr_1', turnId: 'turn_1', item: { type: 'agentMessage', id: 'msg_a', text: 'first saved message', phase: null, memoryCitation: null }, completedAtMs: 1 } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thr_1', turnId: 'turn_1', item: { type: 'agentMessage', id: 'msg_b', text: 'second saved message', phase: null, memoryCitation: null }, completedAtMs: 2 } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn_1', status: 'completed' } } })}\n`);
          continue;
        }
        if (text === 'collab tool call') {
          stdout.write(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thr_1', turnId: 'turn_1', item: { type: 'collabToolCall', id: 'collab_1', tool: 'my_collab', status: 'completed', receiverThreadId: 'thr_2', agentStatus: 'idle' } } })}\n`);
          stdout.write(`${JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn_1', status: 'completed' } } })}\n`);
          continue;
        }
        if (text === 'legacy command approval') {
          stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: 150,
            method: 'execCommandApproval',
            params: {
              conversationId: 'thr_1',
              callId: 'cmd_legacy_1',
              command: ['npm', 'test'],
              cwd: '/repo',
            },
          })}\n`);
          continue;
        }
        if (text === 'legacy patch approval') {
          stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: 151,
            method: 'applyPatchApproval',
            params: {
              conversationId: 'thr_1',
              callId: 'patch_legacy_1',
              fileChanges: { 'src/a.ts': { type: 'add', content: 'new content' } },
            },
          })}\n`);
          continue;
        }
        if (text === 'started item caching approval') {
          stdout.write(`${JSON.stringify({ method: 'item/started', params: { threadId: 'thr_1', turnId: 'turn_1', item: { type: 'fileChange', id: 'fc_cached_1', changes: [{ path: 'src/a.ts', kind: 'add', diff: 'cached new file' }], status: 'inProgress' } } })}\n`);
          stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: 152,
            method: 'item/fileChange/requestApproval',
            params: {
              threadId: 'thr_1',
              turnId: 'turn_1',
              itemId: 'fc_cached_1',
            },
          })}\n`);
          continue;
        }
        stdout.write(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'hello from app-server' } })}\n`);
        stdout.write(`${JSON.stringify({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'msg_1', text: 'hello from app-server' } } })}\n`);
        stdout.write(`${JSON.stringify({
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: 'thr_1',
            turnId: 'turn_1',
            tokenUsage: {
              last: { inputTokens: 10, cachedInputTokens: 3, outputTokens: 5, reasoningOutputTokens: 2 },
            },
          },
        })}\n`);
        stdout.write(`${JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn_1', status: 'completed' } } })}\n`);
      }
    }
  });

  return child;
}

afterEach(() => {
  setCodexAppServerSpawn(undefined);
});

describe('selectLanguageModel', () => {
  it('uses the Codex app-server flow for openai-codex', async () => {
    const child = createFakeAppServer();
    const spawnAppServer = vi.fn(() => child);
    setCodexAppServerSpawn(spawnAppServer as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    });

    expect(result.content).toMatchObject([{ type: 'text', text: 'hello from app-server' }]);
    expect(result.usage).toMatchObject({
      inputTokens: { total: 10, noCache: 7, cacheRead: 3 },
      outputTokens: { total: 5, text: 3, reasoning: 2 },
    });
    expect(spawnAppServer).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['app-server', '--stdio', '--disable', 'plugins']),
      expect.any(Object),
    );
    expect(child.requests.map((req) => (req as { method?: string }).method)).toEqual([
      'initialize',
      'initialized',
      'thread/start',
      'turn/start',
    ]);
    const turnStart = child.requests.find((req) => (req as { method?: string }).method === 'turn/start') as {
      params: { effort?: string };
    };
    expect(turnStart.params.effort).toBe('none');
  });

  it('keeps separate Codex RPCs per cwd', async () => {
    const childA = createFakeAppServer();
    const childB = createFakeAppServer();
    const spawnAppServer = vi.fn()
      .mockImplementationOnce(() => childA)
      .mockImplementationOnce(() => childB);
    setCodexAppServerSpawn(spawnAppServer as never);

    const modelA = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
      cwd: '/tmp/a',
    }) as any;
    const modelB = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
      cwd: '/tmp/b',
    }) as any;

    await modelA.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    });
    await modelB.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    });

    expect(spawnAppServer).toHaveBeenCalledTimes(2);
    expect(spawnAppServer.mock.calls.map((call) => call[2]?.cwd)).toEqual(['/tmp/a', '/tmp/b']);
  });

  it('injects history instead of stuffing it into developer instructions', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    await model.doGenerate({
      prompt: [
        { role: 'system', content: 'system rules' },
        { role: 'user', content: [{ type: 'text', text: 'old question' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'old answer' }] },
        { role: 'user', content: [{ type: 'text', text: 'new question' }] },
      ],
    });

    const threadStart = child.requests.find((req) => (req as { method?: string }).method === 'thread/start') as {
      params: { baseInstructions?: string; developerInstructions?: string };
    };
    const injected = child.requests.find((req) => (req as { method?: string }).method === 'thread/inject_items') as {
      params: { items?: unknown[] };
    };
    const turnStart = child.requests.find((req) => (req as { method?: string }).method === 'turn/start') as {
      params: { input?: unknown[] };
    };

    expect(threadStart.params.baseInstructions).toBe('system rules');
    expect(threadStart.params.developerInstructions).not.toContain('old question');
    expect(injected.params.items).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'old question' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'old answer' }] },
    ]);
    expect(turnStart.params.input).toEqual([{ type: 'text', text: 'new question', text_elements: [] }]);
  });

  it('responds to Codex dynamic tools with app-server content item casing', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'call tool' }] }],
      tools: [{
        type: 'function',
        name: 'grep',
        description: 'Search',
        inputSchema: { type: 'object' },
      }],
    });

    expect(result.content).toEqual([{
      type: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'grep',
      input: '{"body":"hi"}',
    }]);
    const response = child.requests.find((req) => (req as { id?: number; method?: string }).id === 99 && !(req as { method?: string }).method) as {
      result?: { contentItems?: { type?: string; text?: string }[] };
    };
    expect(response.result?.contentItems?.[0]?.type).toBe('inputText');
    expect(response.result?.contentItems?.[0]?.text).toBe('');
    expect(child.requests.filter((req) => (req as { method?: string }).method === 'turn/interrupt')).toHaveLength(1);
  });

  it('coalesces parallel Codex dynamic tool calls into one model step', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'call tools' }] }],
      tools: [{
        type: 'function',
        name: 'grep',
        description: 'Search',
        inputSchema: { type: 'object' },
      }],
    });

    expect(result.content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'grep',
        input: '{"body":"hi"}',
      },
      {
        type: 'tool-call',
        toolCallId: 'call_2',
        toolName: 'grep',
        input: '{"body":"bye"}',
      },
    ]);
    expect(child.requests.filter((req) => (req as { method?: string }).method === 'turn/interrupt')).toHaveLength(1);
  });

  it('exposes channel tools while instructing Codex to use final text for current replies', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      tools: [
        { type: 'function', name: 'channel.reply', description: 'Reply', inputSchema: { type: 'object' } },
        { type: 'function', name: 'channel.dm', description: 'DM', inputSchema: { type: 'object' } },
        { type: 'function', name: 'grep', description: 'Search', inputSchema: { type: 'object' } },
      ],
    });

    const threadStart = child.requests.find((req) => (req as { method?: string }).method === 'thread/start') as {
      params: { developerInstructions?: string; dynamicTools?: { name: string }[] };
    };
    expect(threadStart.params.developerInstructions).toContain('final assistant text is automatically published');
    expect(threadStart.params.developerInstructions).toContain('Use channel/message tools only when the user explicitly asks');
    expect(threadStart.params.dynamicTools?.map((tool) => tool.name)).toEqual([
      'ujima_channel_reply',
      'ujima_channel_dm',
      'ujima_grep',
    ]);
  });

  it('keeps separate Codex assistant message items as separate text content', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'separate messages' }] }],
    });

    expect(result.content.filter((part: { type?: string }) => part.type === 'text')).toMatchObject([
      { type: 'text', text: 'first saved message' },
      { type: 'text', text: 'second saved message' },
    ]);
  });

  it('keeps separate completed Codex messages when deltas have no item ids', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    const result = streamText({
      model,
      messages: [{ role: 'user', content: 'separate messages without delta ids' }],
    });

    expect(await result.text).toBe('first saved messagesecond saved message');
    const steps = await result.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0]?.content.filter((part) => part.type === 'text')).toMatchObject([
      { type: 'text', text: 'first saved message' },
      { type: 'text', text: 'second saved message' },
    ]);
  });

  it('does not reuse the first fallback text item for later completed messages', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'fallback text merge' }] }],
    });

    expect(result.content.filter((part: { type?: string }) => part.type === 'text')).toMatchObject([
      { type: 'text', text: 'first saved message' },
      { type: 'text', text: 'second saved message' },
    ]);
  });

  it('translates native Codex command approvals into Ujima shell tool calls', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'native command approval' }] }],
      tools: [{ type: 'function', name: 'shell', description: 'Shell', inputSchema: { type: 'object' } }],
    });

    expect(result.content).toEqual([{
      type: 'tool-call',
      toolCallId: 'cmd_1',
      toolName: 'shell',
      input: '{"command":"npm test","cwd":"/repo"}',
    }]);
    const declined = child.requests.find((req) => (req as { id?: number }).id === 120 && !(req as { method?: string }).method) as {
      result?: { decision?: string };
    };
    expect(declined.result?.decision).toBe('decline');
  });

  it('translates native Codex file approval requests into Ujima edit tool calls', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'native file approval edit' }] }],
      tools: [{ type: 'function', name: 'edit', description: 'Edit', inputSchema: { type: 'object' } }],
    });

    expect(result.content).toEqual([{
      type: 'tool-call',
      toolCallId: 'patch_approval_1',
      toolName: 'edit',
      input: '{"file_path":"src/a.ts","old_string":"old","new_string":"new"}',
    }]);
    const declined = child.requests.find((req) => (req as { id?: number }).id === 121 && !(req as { method?: string }).method) as {
      result?: { decision?: string };
    };
    expect(declined.result?.decision).toBe('decline');
  });

  it('keeps patch-only native Codex file approval requests visible as shell calls', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'native file approval patch' }] }],
      tools: [{ type: 'function', name: 'shell', description: 'Shell', inputSchema: { type: 'object' } }],
    });

    expect(result.content).toMatchObject([{
      type: 'tool-call',
      toolCallId: 'patch_approval_2',
      toolName: 'shell',
    }]);
    expect((result.content[0] as { input?: string }).input).toContain('apply_patch');
  });

  it('surfaces native Codex file changes as provider-executed Ujima edit results', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'native file change' }] }],
      tools: [{ type: 'function', name: 'edit', description: 'Edit', inputSchema: { type: 'object' } }],
    });

    expect(result.content).toMatchObject([
      {
        type: 'tool-call',
        toolCallId: 'patch_1',
        toolName: 'edit',
        providerExecuted: true,
      },
      {
        type: 'tool-result',
        toolCallId: 'patch_1',
        toolName: 'edit',
        isError: false,
        result: { status: 'completed', diff: expect.stringContaining('-old') },
      },
    ]);
  });

  it('keeps native Codex file changes visible in stream step content without continuing the loop', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    const result = streamText({
      model,
      messages: [{ role: 'user', content: 'native file change' }],
      stopWhen: stepCountIs(6),
    });

    await result.consumeStream();
    const steps = await result.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0]?.content).toMatchObject([
      {
        type: 'tool-call',
        toolCallId: 'patch_1',
        toolName: 'edit',
        providerExecuted: true,
      },
      {
        type: 'tool-result',
        toolCallId: 'patch_1',
        toolName: 'edit',
        output: { status: 'completed', diff: expect.stringContaining('-old') },
        providerExecuted: true,
      },
    ]);
  });

  it('runs a simulated six-turn Codex agent loop through the AI SDK', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4-mini',
    }) as any;
    const toolTurns: number[] = [];

    const result = streamText({
      model,
      messages: [{ role: 'user', content: 'six turn loop' }],
      stopWhen: stepCountIs(6),
      tools: {
        progress: {
          inputSchema: jsonSchema({ type: 'object', properties: { turn: { type: 'number' } } }),
          execute: async ({ turn }: { turn: number }) => {
            toolTurns.push(turn);
            return { ok: true, turn };
          },
        },
      },
    });

    expect(await result.text).toBe('first saved messagesecond saved message');
    const steps = await result.steps;
    expect(steps).toHaveLength(6);
    expect(toolTurns).toEqual([1, 2, 3, 4, 5]);
    expect((await result.content).filter((part) => part.type === 'text')).toMatchObject([
      { type: 'text', text: 'first saved message' },
      { type: 'text', text: 'second saved message' },
    ]);
  });

  it('correctly maps collabToolCall items', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'collab tool call' }] }],
      tools: [{ type: 'function', name: 'agent.delegate', description: 'delegate', inputSchema: { type: 'object' } }],
    });

    expect(result.content).toMatchObject([
      {
        type: 'tool-call',
        toolCallId: 'collab_1',
        toolName: 'agent.delegate',
        providerExecuted: true,
      },
      {
        type: 'tool-result',
        toolCallId: 'collab_1',
        toolName: 'agent.delegate',
        result: {
          status: 'completed',
          receiverThreadId: 'thr_2',
          agentStatus: 'idle',
        },
      },
    ]);
  });

  it('correctly handles legacy execCommandApproval and declines with decline', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'legacy command approval' }] }],
      tools: [{ type: 'function', name: 'shell', description: 'shell', inputSchema: { type: 'object' } }],
    });

    expect(result.content).toMatchObject([
      {
        type: 'tool-call',
        toolCallId: 'cmd_legacy_1',
        toolName: 'shell',
        input: '{"command":"npm","args":["test"],"cwd":"/repo"}',
      },
    ]);

    const declined = child.requests.find((req) => (req as { id?: number }).id === 150 && !(req as { method?: string }).method) as {
      result?: { decision?: string };
    };
    expect(declined.result?.decision).toBe('decline');
  });

  it('correctly handles legacy applyPatchApproval and declines with decline', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'legacy patch approval' }] }],
      tools: [{ type: 'function', name: 'shell', description: 'shell', inputSchema: { type: 'object' } }],
    });

    expect(result.content).toMatchObject([
      {
        type: 'tool-call',
        toolCallId: 'patch_legacy_1',
        toolName: 'shell',
      },
    ]);
    expect((result.content[0] as { input?: string }).input).toContain('apply_patch');

    const declined = child.requests.find((req) => (req as { id?: number }).id === 151 && !(req as { method?: string }).method) as {
      result?: { decision?: string };
    };
    expect(declined.result?.decision).toBe('decline');
  });

  it('caches proposed changes from item/started for file change approval request', async () => {
    const child = createFakeAppServer();
    setCodexAppServerSpawn(vi.fn(() => child) as never);

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4',
    }) as any;

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'started item caching approval' }] }],
      tools: [{ type: 'function', name: 'write', description: 'write', inputSchema: { type: 'object' } }],
    });

    expect(result.content).toMatchObject([
      {
        type: 'tool-call',
        toolCallId: 'fc_cached_1',
        toolName: 'write',
        input: '{"file_path":"src/a.ts","content":"cached new file"}',
      },
    ]);

    const declined = child.requests.find((req) => (req as { id?: number }).id === 152 && !(req as { method?: string }).method) as {
      result?: { decision?: string };
    };
    expect(declined.result?.decision).toBe('decline');
  });
});
