import { expect, test } from 'vitest';
import { SpiritRunState } from './spirit-run-state.js';
import type { Spirit } from '@ujima/shared';

const baseSpirit: Spirit = {
  id: 'spirit-1',
  organizationId: 'org-1',
  memberId: 'member-1',
  taskSessionId: 'task-1',
  role: 'worker',
  runId: 'run-1',
  status: 'running',
  iteration: 0,
  tokensUsed: 0,
  lastMessageId: undefined,
  lastError: undefined,
} as Spirit;

test('initial phase is running, iteration is 0', () => {
  const state = new SpiritRunState();
  expect(state.phase).toBe('running');
  expect(state.iteration).toBe(0);
  expect(state.toolCallCount).toBe(0);
  expect(state.totalTokens).toBe(0);
});

test('trackStep increments iteration and tool calls', () => {
  const state = new SpiritRunState();
  state.trackStep(3, { input: 10, output: 5 });
  expect(state.iteration).toBe(1);
  expect(state.toolCallCount).toBe(3);
  expect(state.totalTokens).toBe(15);
});

test('complete sets phase, lastText, lastMessageId', () => {
  const state = new SpiritRunState();
  state.complete('Done', 'msg-1');
  expect(state.phase).toBe('completed');
  expect(state.lastText).toBe('Done');
  expect(state.lastMessageId).toBe('msg-1');
});

test('fail sets phase and error', () => {
  const state = new SpiritRunState();
  state.fail('oops');
  expect(state.phase).toBe('failed');
  expect(state.error).toBe('oops');
});

test('cancel sets phase and optional text', () => {
  const state = new SpiritRunState();
  state.cancel();
  expect(state.phase).toBe('cancelled');
  expect(state.lastText).toBe('');

  const state2 = new SpiritRunState();
  state2.cancel('stopped by user');
  expect(state2.lastText).toBe('stopped by user');
});

test('waitForApproval sets phase', () => {
  const state = new SpiritRunState();
  state.waitForApproval();
  expect(state.phase).toBe('waiting_for_approval');
});

test('waitForInput sets phase', () => {
  const state = new SpiritRunState();
  state.waitForInput();
  expect(state.phase).toBe('waiting_for_input');
});

test('applyToSpirit merges state into spirit', () => {
  const state = new SpiritRunState();
  state.trackStep(2, { input: 20, output: 10 });
  state.complete('Finished', 'msg-a');

  const result = state.applyToSpirit(baseSpirit);
  expect(result.status).toBe('completed');
  expect(result.iteration).toBe(1); // base 0 + tracked 1
  expect(result.tokensUsed).toBe(30); // base 0 + tracked 30
  expect(result.lastMessageId).toBe('msg-a');
});

test('applyToSpirit preserves existing spirit fields', () => {
  const state = new SpiritRunState();
  const result = state.applyToSpirit(baseSpirit);
  expect(result.id).toBe(baseSpirit.id);
  expect(result.memberId).toBe(baseSpirit.memberId);
  expect(result.role).toBe('worker');
});

test('cumulative iteration across multiple trackStep calls', () => {
  const state = new SpiritRunState();
  state.trackStep(1);
  state.trackStep(2);
  state.trackStep(3);
  expect(state.iteration).toBe(3);
  expect(state.toolCallCount).toBe(6);
});
