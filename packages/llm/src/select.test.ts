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
      if (msg.method === 'turn/start') {
        stdout.write(`${JSON.stringify({ id: msg.id, result: { turn: { id: 'turn_1' } } })}\n`);
        stdout.write(`${JSON.stringify({ method: 'turn/started', params: { turn: { id: 'turn_1', status: 'inProgress', items: [] } } })}\n`);
        stdout.write(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'hello from app-server' } })}\n`);
        stdout.write(`${JSON.stringify({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'msg_1', text: 'hello from app-server' } } })}\n`);
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
    expect(spawnAppServer).toHaveBeenCalledWith('codex', ['app-server', '--stdio'], expect.any(Object));
    expect(child.requests.map((req) => (req as { method?: string }).method)).toEqual([
      'initialize',
      'initialized',
      'thread/start',
      'turn/start',
    ]);
  });
});
