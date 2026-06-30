import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test } from 'vitest';
import { AgentLoopLogger } from './agent-loop-logger.js';

afterEach(() => {
  delete process.env.UJIMA_AGENT_LOOP_LOGS;
});

test('writes one .agent-loop file per agent turn', async () => {
  process.env.UJIMA_AGENT_LOOP_LOGS = '1';
  const root = await mkdtemp(join(tmpdir(), 'ujima-agent-loop-'));
  const logger = new AgentLoopLogger();
  logger.setWorkspaceRoot(root);
  logger.setContext({
    agentId: 'worker',
    threadId: 'thread-1',
    systemPrompt: 'sys',
    messages: [{ role: 'user', content: 'hello' } as any],
    tools: { foo: { description: 'bar', inputSchema: { type: 'object' } } as any },
  });

  await logger.handleStepFinish({
    text: 'first',
    toolCalls: [],
    toolResults: [],
    usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
  } as any);
  await logger.handleStepFinish({
    text: 'second',
    toolCalls: [],
    toolResults: [],
    usage: { inputTokens: 7, outputTokens: 11, totalTokens: 18 },
  } as any);
  await logger.flush();

  const files = (await readdir(join(root, '.agent-loop'))).sort();
  expect(files).toHaveLength(2);
  expect(files.every((f) => /-turn-\d{3}\.json$/.test(f))).toBe(true);

  const logs = await Promise.all(
    files.map(async (f) => JSON.parse(await readFile(join(root, '.agent-loop', f), 'utf-8'))),
  );
  expect(logs.map((log) => log.turnIndex)).toEqual([1, 2]);
  expect(logs.map((log) => log.steps[0].text)).toEqual(['first', 'second']);
  expect(logs.map((log) => log.tokenUsage.totalTokens)).toEqual([8, 18]);
  expect(logs.every((log) => log.systemPrompt === 'sys')).toBe(true);
  expect(logs.every((log) => log.tools?.foo?.description === 'bar')).toBe(true);
});
