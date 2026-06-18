import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
      if (msg.method === 'turn/start') {
        const text = (((msg.params as { input?: { text?: string }[] }).input ?? [])[0]?.text) ?? '';
        stdout.write(`${JSON.stringify({ id: msg.id, result: { turn: { id: 'turn_1' } } })}\n`);
        stdout.write(`${JSON.stringify({ method: 'turn/started', params: { turn: { id: 'turn_1', status: 'inProgress', items: [] } } })}\n`);
        if (text === 'call tool') {
          stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: 99,
            method: 'item/tool/call',
            params: {
              threadId: 'thr_1',
              turnId: 'turn_1',
              callId: 'call_1',
              tool: 'ujima_channel_reply',
              arguments: { body: 'hi' },
            },
          })}\n`);
          stdout.write(`${JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn_1', status: 'completed' } } })}\n`);
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

    expect(result.content).toEqual([{ type: 'text', text: 'hello from app-server' }]);
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
        name: 'channel.reply',
        description: 'Reply',
        inputSchema: { type: 'object' },
      }],
    });

    expect(result.content).toEqual([{
      type: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'channel.reply',
      input: '{"body":"hi"}',
    }]);
    const response = child.requests.find((req) => (req as { id?: number; method?: string }).id === 99 && !(req as { method?: string }).method) as {
      result?: { contentItems?: { type?: string }[] };
    };
    expect(response.result?.contentItems?.[0]?.type).toBe('input_text');
  });
});
