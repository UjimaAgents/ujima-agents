import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test } from 'vitest';
import { AgentLoopLogger } from './agent-loop-logger.js';

let tmpHome = '';

afterEach(async () => {
  delete process.env.UJIMA_AGENT_LOOP_LOGS;
  delete process.env.UJIMA_HOME;
  tmpHome = '';
});

test('writes one agent-loop file per step + done summary', async () => {
  tmpHome = await mkdtemp(join(tmpdir(), 'ujima-agent-loop-'));
  process.env.UJIMA_HOME = tmpHome;
  const logger = new AgentLoopLogger();
  logger.setContext({
    agentId: 'worker',
    threadId: 'thread-1',
    systemPrompt: 'sys',
    messages: [{ role: 'user', content: 'hello' }] as any,
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
  logger.setTokenUsage({ inputTokens: 7, outputTokens: 16, totalTokens: 23 });
  await logger.flush();

  const dir = join(tmpHome, 'agent-loop');
  const files = (await readdir(dir)).sort();
  // turn-000, turn-001, and -done
  expect(files.length).toBeGreaterThanOrEqual(2);
  expect(files.some((f) => /-turn-\d{3}\.json$/.test(f))).toBe(true);

  const logs = await Promise.all(
    files.map(async (f) => JSON.parse(await readFile(join(dir, f), 'utf-8'))),
  );
  const turnLogs = logs.filter((log) => log.turnIndex !== undefined && !log.runFinished);
  expect(turnLogs.map((log) => log.turnIndex)).toEqual([0, 1]);

  // Each step file captures the full agent context
  for (const log of turnLogs) {
    expect(log.systemPrompt).toBe('sys');
    expect(log.tools?.foo?.description).toBe('bar');
    expect(log.messages).toBeDefined();
    expect(log.messagesAtStep).toBeDefined();
    expect(log.cumulativeTokens).toBeDefined();
  }

  // Step 0: initial messages only
  expect(turnLogs[0].priorSteps).toEqual([]);
  expect(turnLogs[0].step.text).toBe('first');
  expect(turnLogs[0].cumulativeTokens.totalTokens).toBe(8);

  // Step 1: has prior step
  expect(turnLogs[1].priorSteps).toHaveLength(1);
  expect(turnLogs[1].step.text).toBe('second');
  expect(turnLogs[1].cumulativeTokens.totalTokens).toBe(26);

  const doneLog = logs.find((log) => log.runFinished);
  expect(doneLog?.cumulativeTokens).toEqual({ inputTokens: 10, outputTokens: 16, totalTokens: 26 });

  // messagesAtStep for step 1 includes reconstructed assistant + tool messages from step 0
  const msgRoles = (turnLogs[1].messagesAtStep as any[]).map((m: any) => m.role);
  expect(msgRoles).toContain('assistant');
});

test('flush writes bare entry when no steps happened', async () => {
  tmpHome = await mkdtemp(join(tmpdir(), 'ujima-agent-loop-'));
  process.env.UJIMA_HOME = tmpHome;
  const logger = new AgentLoopLogger();
  await logger.flush();

  const files = await readdir(join(tmpHome, 'agent-loop'));
  expect(files).toHaveLength(1);
});

test('disabled via env var', async () => {
  tmpHome = await mkdtemp(join(tmpdir(), 'ujima-agent-loop-'));
  process.env.UJIMA_HOME = tmpHome;
  process.env.UJIMA_AGENT_LOOP_LOGS = '0';
  const logger = new AgentLoopLogger();
  logger.setContext({
    agentId: 'worker',
    threadId: 'thread-1',
  });
  await logger.handleStepFinish({
    text: 'first',
    toolCalls: [],
    toolResults: [],
  } as any);
  await logger.flush();

  await expect(readdir(join(tmpHome, 'agent-loop'))).rejects.toThrow(/ENOENT/);
});
